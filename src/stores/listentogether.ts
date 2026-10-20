import {
  MULTI_SONG_OPERATE,
  multiListenCreate,
  multiListenExit,
  multiListenHeartbeat,
  multiListenJoin,
  multiListenOperate,
  multiListenStatus,
  type MultiListenPlayInfo,
  type MultiListenRoomInfo,
  type MultiListenSnapshot,
  type MultiListenUserAgg,
} from "@/api/multilisten";
import { songDetail } from "@/api/song";
import { useDataStore } from "./data";
import { useMusicStore } from "./music";
import { useStatusStore } from "./status";
import type { SongType } from "@/types/main";
import { isLogin } from "@/utils/auth";
import { formatSongsList } from "@/utils/format";
import { defineStore } from "pinia";
import { watch } from "vue";

/** 房间状态刷新间隔（毫秒） */
const ROOM_REFRESH_INTERVAL = 4000;
/** 默认心跳间隔（毫秒），服务端会覆盖 */
const DEFAULT_HEARTBEAT_INTERVAL = 30000;
/** 应用远端状态后的静默时长（毫秒） */
const REMOTE_SILENCE_DURATION = 4000;
/** 进度误差容忍（毫秒） */
const SEEK_TOLERANCE = 3000;

/** 播放器状态监听 */
let playerWatchers: Array<ReturnType<typeof watch>> = [];
/** 远端状态静默定时器 */
let remoteSilenceTimer: number | null = null;
/** 房间失效提示是否已展示 */
let offlineNoticeShown = false;

/** 房间在线成员 */
export interface ListenTogetherUser {
  userId: number;
  nickname: string;
  avatarUrl: string;
}

interface ListenTogetherState {
  /** 播放模式：普通播放 / 一起听 */
  mode: "normal" | "room";
  /** 普通播放的歌单快照 */
  normalPlayList: SongType[];
  /** 普通播放的索引快照 */
  normalPlayIndex: number;
  /** 普通播放的歌曲快照 */
  normalSong: SongType | null;
  /** 普通播放的进度快照 */
  normalProgress: number;
  /** 普通播放是否在播放中 */
  normalPlaying: boolean;
  /** 房间号 */
  roomId: string;
  /** 邀请者 ID */
  inviterId: number;
  /** 是否为房主 */
  isCreator: boolean;
  /** 房间业务类型：1 双人，2 多人 */
  roomBizType: number;
  /** 是否在房间中 */
  inRoom: boolean;
  /** 在线成员 */
  members: ListenTogetherUser[];
  /** 在线人数（服务端口径） */
  onlineNums: number;
  /** 房间状态文案 */
  roomStatusText: string;
  /** 是否跟随房间播放 */
  followEnabled: boolean;
  /** 分享链接中的歌曲 ID */
  shareSongId: number;
  /** 房间当前曲目 ID */
  currentTrackId: number;
  /** 房间当前曲目的 bizId，切歌时回传 */
  currentSongBizId: number;
  /** 房间当前曲目 */
  currentTrack: SongType | null;
  /** 房间播放状态（多人房间不区分暂停，保留给界面展示） */
  remotePlayStatus: "PLAY" | "PAUSE";
  /** 房间播放进度（毫秒） */
  remoteProgress: number;
  /** 进度采样时间戳 */
  progressSampledAt: number;
  /** 房间曲目总时长（毫秒） */
  remoteDuration: number;
  /** 房间歌单（来自 nextSongs） */
  roomTrackIds: number[];
  /** 房间待播队列（含 bizId） */
  queueSongs: Array<{ songId: number; bizId: number }>;
  /** 房间待播队列详情 */
  queueTracks: SongType[];
  /** 当前曲目被赞次数 */
  zanCount: number;
  /** 队列里待播数量（服务端口径） */
  waitSongCount: number;
  /** 上次同步时间 */
  lastSyncTime: number;
  /** 已应用的远端状态标识 */
  appliedRemoteKey: string;
  /** 是否正在应用远端状态 */
  isApplyingRemote: boolean;
  /** 房间状态定时器 */
  roomTimer: number | null;
  /** 心跳定时器 */
  heartbeatTimer: number | null;
  /** 服务端下发的心跳间隔（毫秒） */
  heartbeatDuration: number;
  /** 是否正在刷新房间 */
  refreshing: boolean;
  /** 点歌冷却结束时间戳（毫秒） */
  addCooldownEnd: number;
  /** 冷却倒计时用的时间刻度 */
  cooldownTick: number;
}

/** 转为数字 ID */
const toId = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 0;
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : 0;
};

/** 读取房间当前播放信息 */
const readPlayInfo = (snapshot: MultiListenSnapshot): MultiListenPlayInfo => {
  return snapshot.roomPlaySongInfo ?? {};
};

/** 估算当前进度 */
const readProgress = (playInfo: MultiListenPlayInfo): number => {
  const played = Number(playInfo.playedTime ?? 0);
  return Number.isFinite(played) && played > 0 ? played : 0;
};

export const useListenTogetherStore = defineStore("listenTogether", {
  state: (): ListenTogetherState => ({
    mode: "normal",
    normalPlayList: [],
    normalPlayIndex: 0,
    normalSong: null,
    normalProgress: 0,
    normalPlaying: false,
    roomId: "",
    inviterId: 0,
    isCreator: false,
    roomBizType: 0,
    inRoom: false,
    members: [],
    onlineNums: 0,
    roomStatusText: "",
    followEnabled: true,
    shareSongId: 0,
    currentTrackId: 0,
    currentSongBizId: 0,
    currentTrack: null,
    remotePlayStatus: "PLAY",
    remoteProgress: 0,
    progressSampledAt: 0,
    remoteDuration: 0,
    roomTrackIds: [],
    queueSongs: [],
    queueTracks: [],
    zanCount: 0,
    waitSongCount: 0,
    lastSyncTime: 0,
    appliedRemoteKey: "",
    isApplyingRemote: false,
    roomTimer: null,
    heartbeatTimer: null,
    heartbeatDuration: DEFAULT_HEARTBEAT_INTERVAL,
    refreshing: false,
    addCooldownEnd: 0,
    cooldownTick: 0,
  }),
  getters: {
    /** 邀请链接（官方多人分享页） */
    shareLink(state): string {
      if (!state.roomId) return "";
      const uid = state.inviterId || useDataStore().userData.userId || 0;
      return `https://st.music.163.com/listen-together/multishare/index.html?roomId=${encodeURIComponent(state.roomId)}&inviterUid=${uid}&isFLT=false`;
    },
    /** 在线人数 */
    memberCount(state): number {
      return state.members.length || state.onlineNums;
    },
    /** 一起听模式的完整歌单：当前曲目 + 待播队列 */
    roomPlayList(state): SongType[] {
      const list: SongType[] = [];
      if (state.currentTrack) list.push(state.currentTrack);
      for (const track of state.queueTracks) {
        if (track.id !== state.currentTrackId) list.push(track);
      }
      return list;
    },
    /** 是否处于一起听模式 */
    inRoomMode(state): boolean {
      return state.mode === "room";
    },
    /** 点歌冷却剩余秒数 */
    addCooldownRemain(state): number {
      const left = Math.ceil((state.addCooldownEnd - state.cooldownTick) / 1000);
      return left > 0 ? left : 0;
    },
  },
  actions: {
    /** 进入一起听模式：备份普通播放状态，切到房间歌单 */
    enterRoomMode() {
      if (this.mode === "room") return;
      const dataStore = useDataStore();
      const statusStore = useStatusStore();
      const musicStore = useMusicStore();
      this.normalPlayList = dataStore.playList.map((song) => ({ ...song }));
      this.normalPlayIndex = statusStore.playIndex;
      this.normalSong = musicStore.playSong?.id ? { ...musicStore.playSong } : null;
      this.normalPlaying = statusStore.playStatus;
      this.normalProgress = 0;
      import("@/core/player/PlayerController")
        .then(({ usePlayerController }) => {
          this.normalProgress = usePlayerController().getSeek() || 0;
        })
        .catch(() => undefined);
      this.mode = "room";
    },
    /** 把房间歌单同步到播放器队列，一起听时播放列表只显示房间歌曲 */
    syncRoomPlayList() {
      if (this.mode !== "room") return;
      const dataStore = useDataStore();
      const statusStore = useStatusStore();
      const list = this.roomPlayList;
      if (!list.length) return;
      const key = list.map((song) => song.id).join(",");
      const oldKey = dataStore.playList.map((song) => song.id).join(",");
      if (key !== oldKey) dataStore.playList = list;
      const index = list.findIndex((song) => song.id === this.currentTrackId);
      if (index >= 0 && statusStore.playIndex !== index) statusStore.playIndex = index;
    },
    /** 退出一起听模式：还原普通播放的歌单与进度 */
    restoreNormalMode() {
      if (this.mode !== "room") return;
      this.mode = "normal";
      const dataStore = useDataStore();
      const statusStore = useStatusStore();
      if (this.normalPlayList.length) {
        dataStore.playList = this.normalPlayList.map((song) => ({ ...song }));
        const index = Math.min(this.normalPlayIndex, dataStore.playList.length - 1);
        statusStore.playIndex = Math.max(index, 0);
      }
      const song = this.normalSong;
      if (song?.id) {
        import("@/core/player/PlayerController")
          .then(({ usePlayerController }) => {
            return usePlayerController().playSong({
              song,
              seek: this.normalProgress,
              autoPlay: this.normalPlaying,
            });
          })
          .catch(() => undefined);
      }
      this.normalPlayList = [];
      this.normalSong = null;
      this.normalProgress = 0;
    },
    /** 给房间当前播放的歌曲点个赞 */
    async likeCurrentSong() {
      if (!this.inRoom || !this.roomId || !this.currentTrackId) return false;
      try {
        const result = await multiListenOperate({
          roomId: this.roomId,
          songId: this.currentTrackId,
          bizId: this.currentSongBizId || 0,
          operate: MULTI_SONG_OPERATE.LIKE,
        });
        if (!result || result.code !== 200) {
          window.$message.warning(result?.message || "点赞失败");
          return false;
        }
        this.zanCount += 1;
        window.$message.success("已点赞");
        return true;
      } catch (error) {
        console.warn("一起听点赞失败：", error);
        return false;
      }
    },
    /**
     * 创建一起听房间
     * @param roomType 1 双人，2 多人
     */
    async createRoom(roomType: 1 | 2 = 2) {
      if (!isLogin()) {
        window.$message.warning("请先登录网易云账号");
        return false;
      }
      const musicStore = useMusicStore();
      const songId = musicStore.playSong.id;
      if (!songId) {
        window.$message.warning("请先播放一首歌曲再创建房间");
        return false;
      }
      try {
        const result = await multiListenCreate(songId, roomType);
        if (!result || result.code !== 200) {
          window.$message.error(result?.message || "创建一起听房间失败");
          return false;
        }
        // 创建接口只回 success，房间信息统一从状态快照里取
        const status = await multiListenStatus();
        const snapshot = status?.data?.multiLtRoomSnapshot;
        if (!snapshot?.roomId) {
          window.$message.error(result.message || "创建一起听房间失败");
          return false;
        }
        this.roomId = snapshot.roomId;
        this.inviterId =
          Number(snapshot.multiRoomInfoDTO?.creatorId) ||
          Number(useDataStore().userData.userId) ||
          0;
        this.inRoom = true;
        this.followEnabled = true;
        this.shareSongId = songId;
        this.currentTrackId = 0;
        this.currentSongBizId = 0;
        this.currentTrack = null;
        this.remoteProgress = 0;
        this.remoteDuration = 0;
        this.appliedRemoteKey = "";
        offlineNoticeShown = false;
        this.enterRoomMode();
        this.applySnapshot(snapshot, true);
        this.startTimers();
        this.startPlayerWatchers();
        window.$message.success("一起听房间已创建");
        void this.syncPlaylistToRoom();
        return true;
      } catch (error) {
        console.error("创建一起听房间失败：", error);
        window.$message.error("创建一起听房间失败");
        return false;
      }
    },
    /**
     * 加入多人房间
     * @param roomId 房间号
     * @param inviterId 邀请者 ID
     */
    async joinRoom(roomId: string, inviterId: number | string) {
      if (!isLogin()) {
        window.$message.warning("请先登录网易云账号");
        return false;
      }
      const safeRoomId = String(roomId ?? "").trim();
      const safeInviterId = Number(inviterId);
      if (!safeRoomId || !Number.isFinite(safeInviterId) || safeInviterId <= 0) {
        window.$message.warning("请输入正确的房间号和邀请者 ID");
        return false;
      }
      try {
        const result = await multiListenJoin(safeRoomId, safeInviterId);
        if (!result || result.code !== 200) {
          window.$message.error(result?.message || "加入一起听房间失败");
          return false;
        }
        // 加入接口返回 { success, multiLtRoomSnapshot }
        const payload = (result.data ?? {}) as unknown as {
          success?: boolean;
          multiLtRoomSnapshot?: MultiListenSnapshot;
        };
        const snapshot = payload.multiLtRoomSnapshot;
        if (payload.success !== true || !snapshot?.roomId) {
          window.$message.error("加入房间失败，请确认房间仍然有效");
          return false;
        }
        this.roomId = snapshot.roomId || safeRoomId;
        this.inviterId = safeInviterId;
        this.inRoom = true;
        this.followEnabled = true;
        this.shareSongId = useMusicStore().playSong.id;
        this.currentTrackId = 0;
        this.currentSongBizId = 0;
        this.currentTrack = null;
        this.remoteProgress = 0;
        this.remoteDuration = 0;
        this.appliedRemoteKey = "";
        offlineNoticeShown = false;
        this.enterRoomMode();
        this.applySnapshot(snapshot, true);
        this.startTimers();
        this.startPlayerWatchers();
        window.$message.success("已加入一起听房间");
        void this.syncPlaylistToRoom();
        return true;
      } catch (error) {
        console.error("加入一起听房间失败：", error);
        window.$message.error("加入一起听房间失败");
        return false;
      }
    },
    /**
     * 离开房间
     * @param close 是否关闭房间（多人房间交由服务端判断）
     */
    async leaveRoom(close = false) {
      void close;
      const roomId = this.roomId;
      this.stopTimers();
      this.stopPlayerWatchers();
      if (roomId) {
        try {
          await multiListenExit(roomId);
        } catch (error) {
          console.warn("退出一起听房间失败：", error);
        }
      }
      this.resetRoom();
      window.$message.success("已退出一起听房间");
    },
    /** 重置房间状态 */
    resetRoom() {
      this.restoreNormalMode();
      this.roomId = "";
      this.inviterId = 0;
      this.isCreator = false;
      this.roomBizType = 0;
      this.inRoom = false;
      this.members = [];
      this.onlineNums = 0;
      this.roomStatusText = "";
      this.followEnabled = true;
      this.shareSongId = 0;
      this.currentTrackId = 0;
      this.currentSongBizId = 0;
      this.currentTrack = null;
      this.remotePlayStatus = "PLAY";
      this.remoteProgress = 0;
      this.progressSampledAt = 0;
      this.progressSampledAt = 0;
      this.remoteDuration = 0;
      this.roomTrackIds = [];
      this.queueSongs = [];
      this.queueTracks = [];
      this.zanCount = 0;
      this.waitSongCount = 0;
      this.lastSyncTime = 0;
      this.appliedRemoteKey = "";
      this.isApplyingRemote = false;
      this.refreshing = false;
    },
    /** 开始房间定时任务 */
    startTimers() {
      this.stopTimers();
      this.roomTimer = window.setInterval(() => {
        this.cooldownTick = Date.now();
        void this.refreshRoom();
      }, ROOM_REFRESH_INTERVAL);
      this.restartHeartbeat();
      void this.sendHeartbeat();
    },
    /** 按服务端下发间隔重启心跳 */
    restartHeartbeat() {
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
      }
      this.heartbeatTimer = window.setInterval(() => {
        void this.sendHeartbeat();
      }, this.heartbeatDuration);
    },
    /** 停止房间定时任务 */
    stopTimers() {
      if (this.roomTimer !== null) {
        window.clearInterval(this.roomTimer);
        this.roomTimer = null;
      }
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    },
    /** 监听播放器切歌 */
    startPlayerWatchers() {
      this.stopPlayerWatchers();
      const musicStore = useMusicStore();
      playerWatchers.push(
        watch(
          () => musicStore.playSong.id,
          (newId, oldId) => {
            if (!this.inRoom || this.isApplyingRemote) return;
            if (!newId || newId === oldId || newId === this.currentTrackId) return;
            void this.addLocalSongToRoom(newId);
          },
        ),
      );
    },
    /** 停止监听播放器状态 */
    stopPlayerWatchers() {
      playerWatchers.forEach((stop) => stop());
      playerWatchers = [];
    },
    /** 刷新房间状态 */
    /** 更新点歌冷却（服务端下发的是秒） */
    setAddCooldown(seconds: number) {
      const value = Number(seconds) || 0;
      this.cooldownTick = Date.now();
      this.addCooldownEnd = value > 0 ? Date.now() + value * 1000 : 0;
    },
    async refreshRoom(force = false) {
      if (!this.inRoom || this.refreshing) return;
      this.refreshing = true;
      try {
        const result = await multiListenStatus();
        if (!result || result.code !== 200) {
          if (result?.code === 488) this.handleRoomOffline(result.message || "一起听房间已失效");
          return;
        }
        const snapshot = result.data?.multiLtRoomSnapshot;
        if (!snapshot) {
          this.handleRoomOffline(result.data?.leaveRoomTitle || "一起听房间已失效");
          return;
        }
        this.setAddCooldown(Number(result.data?.nextAddSongDuration ?? 0));
        this.applySnapshot(snapshot, force);
      } catch (error) {
        console.warn("刷新一起听房间失败：", error);
      } finally {
        this.refreshing = false;
      }
    },
    /**
     * 应用房间快照
     * @param snapshot 房间快照
     * @param force 是否强制对齐播放进度
     */
    applySnapshot(snapshot: MultiListenSnapshot, force = false) {
      const roomInfo: MultiListenRoomInfo = snapshot.multiRoomInfoDTO ?? {};
      const userAgg: MultiListenUserAgg = snapshot.multiLtRoomUserAgg ?? {};
      const playInfo = readPlayInfo(snapshot);
      const dataStore = useDataStore();

      this.roomId = snapshot.roomId || this.roomId;
      if (roomInfo.creatorId) {
        this.inviterId = Number(roomInfo.creatorId) || this.inviterId;
        this.isCreator = Number(roomInfo.creatorId) === dataStore.userData.userId;
      }
      if (roomInfo.roomBizType) this.roomBizType = Number(roomInfo.roomBizType);
      this.roomStatusText = roomInfo.roomClosed ? "房间已关闭" : "房间可用";
      this.members = (userAgg.onlineUserInfos ?? [])
        .map((user) => ({
          userId: toId(user.uid),
          nickname: user.nickname ?? "",
          avatarUrl: user.avatar ?? "",
        }))
        .filter((user) => user.userId > 0);
      this.onlineNums = Number(userAgg.onlineNums ?? this.members.length);
      this.lastSyncTime = Date.now();
      this.zanCount = Number(playInfo.playingSongZanCnt ?? this.zanCount) || 0;
      this.waitSongCount = Number(playInfo.waitSongCount ?? this.waitSongCount) || 0;

      const playSong = playInfo.playSong;
      const trackId = toId(playSong?.songId);
      if (trackId) {
        this.currentSongBizId = toId(playSong?.songBizId);
        this.remoteProgress = readProgress(playInfo);
        this.progressSampledAt = Date.now();
        this.remoteDuration = Number(playInfo.songDuration ?? 0) || this.remoteDuration;
        this.setQueue(
          (playInfo.nextSongs ?? []).map((song) => ({
            songId: toId(song.songId),
            bizId: toId(song.songBizId),
          })),
        );
        const isNewTrack = trackId !== this.currentTrackId;
        this.currentTrackId = trackId;
        if (isNewTrack) void this.loadTrackInfo(trackId);
        void this.applyPlayback(trackId, this.remoteProgress, force || isNewTrack);
      }
      this.syncRoomPlayList();

      if (roomInfo.roomClosed) {
        this.handleRoomOffline("房间已关闭");
      }
    },
    /**
     * 对齐播放器到房间状态
     * @param trackId 曲目 ID
     * @param progress 目标进度（毫秒）
     * @param force 是否强制跟唱
     */
    async applyPlayback(trackId: number, progress: number, force = false) {
      if (!this.followEnabled) return;
      const key = `${trackId}:${Math.floor(progress / 5000)}`;
      if (!force && key === this.appliedRemoteKey) return;
      try {
        const { usePlayerController } = await import("@/core/player/PlayerController");
        const player = usePlayerController();
        const musicStore = useMusicStore();
        const statusStore = useStatusStore();
        const needSwitch = musicStore.playSong.id !== trackId;
        const needSeek = !needSwitch && Math.abs(player.getSeek() - progress) > SEEK_TOLERANCE;
        this.appliedRemoteKey = key;
        if (!needSwitch && !needSeek) {
          // 房间在放，本地却是暂停的（例如进房前暂停过），这里跟上
          if (!statusStore.playStatus) {
            await player.play();
            this.holdRemoteSilence();
          }
          return;
        }
        this.isApplyingRemote = true;
        if (needSwitch) {
          const song = this.currentTrack?.id === trackId
            ? this.currentTrack
            : await this.loadTrackInfo(trackId);
          if (song) {
            await player.playSong({ song, seek: progress, autoPlay: true });
          }
        } else {
          player.setSeek(progress);
        }
        this.holdRemoteSilence();
      } catch (error) {
        console.warn("应用一起听播放状态失败：", error);
        this.isApplyingRemote = false;
      }
    },
    /** 手动对齐一次房间播放状态 */
    async applyRoomPlaybackNow() {
      const result = await multiListenStatus();
      const snapshot = result?.data?.multiLtRoomSnapshot;
      if (!snapshot) {
        window.$message.warning("暂未获取到房间播放信息");
        return;
      }
      this.applySnapshot(snapshot, true);
      window.$message.success("已同步房间播放状态");
    },
    /** 推送当前歌曲到房间 */
    async pushCurrentSong() {
      if (!this.inRoom) return;
      const musicStore = useMusicStore();
      const songId = musicStore.playSong.id;
      if (!songId) {
        window.$message.warning("当前没有播放中的歌曲");
        return;
      }
      if (songId === this.currentTrackId) {
        window.$message.info("房间正在播放这首歌");
        return;
      }
      await this.addSongToRoom(songId);
    },
    /**
     * 本地点歌：只加入房间歌单，不打断房间正在播放的歌
     * @param songId 歌曲 ID
     */
    async addLocalSongToRoom(songId: number) {
      if (!this.inRoom || !this.roomId || !songId) return false;
      const ok = await this.addSongToRoom(songId, true);
      window.$message.success(ok ? "已加入一起听歌单" : "加入一起听歌单失败");
      await this.restoreRoomPlayback();
      return ok;
    },
    /**
     * 往房间队列追加一首歌
     * @param songId 歌曲 ID
     * @param silent 是否静默
     */
    async addSongToRoom(songId: number, silent = false) {
      if (!this.inRoom || !this.roomId || !songId) return false;
      if (this.addCooldownRemain > 0) {
        if (!silent) {
          window.$message.warning(`点歌冷却中，还要等 ${this.addCooldownRemain} 秒`);
        }
        return false;
      }
      try {
        const result = await multiListenOperate({
          roomId: this.roomId,
          songId,
          bizId: 0,
          operate: MULTI_SONG_OPERATE.ADD,
        });
        const data = result?.data;
        const failed =
          data?.result === false ||
          (typeof data?.failedCode === "number" && data.failedCode !== 0);
        if (!result || result.code !== 200 || failed) {
          if (!silent) {
            window.$message.warning(data?.failedMsg || result?.message || "加入房间歌单失败");
          }
          return false;
        }
        if (typeof data?.roomSongInfo?.waitSongCount === "number") {
          this.waitSongCount = data.roomSongInfo.waitSongCount;
        }
        if (data?.roomSongInfo?.nextSongs) {
          this.setQueue(
            data.roomSongInfo.nextSongs.map((song) => ({
              songId: toId(song.songId),
              bizId: toId(song.songBizId),
            })),
          );
        }
        // 新歌排在队列末尾，服务端窗口暂时看不到，本地先补进列表
        if (songId !== this.currentTrackId && !this.queueSongs.some((i) => i.songId === songId)) {
          this.queueSongs.push({ songId, bizId: 0 });
          this.roomTrackIds = this.queueSongs.map((item) => item.songId);
          void this.fetchQueueTracks();
        }
        if (!silent) window.$message.success("已加入房间歌单");
        this.setAddCooldown(Number(data?.nextAddSongDuration ?? 60));
        return true;
      } catch (error) {
        console.warn("加入一起听歌单失败：", error);
        if (!silent) window.$message.warning("加入房间歌单失败");
        return false;
      }
    },
    /** 把本地播放器拉回房间当前曲目与进度 */
    async restoreRoomPlayback() {
      if (!this.followEnabled || !this.currentTrackId) return;
      const elapsed = this.progressSampledAt ? Date.now() - this.progressSampledAt : 0;
      const progress = this.remoteProgress + Math.max(elapsed, 0);
      this.appliedRemoteKey = "";
      await this.applyPlayback(this.currentTrackId, progress, true);
    },
    /**
     * 更新房间待播队列
     * @param list 队列条目
     */
    setQueue(list: Array<{ songId: number; bizId: number }>) {
      const incoming = list.filter(
        (item) => item.songId > 0 && item.songId !== this.currentTrackId,
      );
      // 服务端每次只下发接下来几首，这里累积成完整队列；窗口内的顺序以服务端为准（顶歌后就地前移）
      const incomingIds = new Set(incoming.map((item) => item.songId));
      const head = incoming.map((item) => {
        const old = this.queueSongs.find((entry) => entry.songId === item.songId);
        return { songId: item.songId, bizId: item.bizId || old?.bizId || 0 };
      });
      const tail = this.queueSongs.filter(
        (item) => item.songId !== this.currentTrackId && !incomingIds.has(item.songId),
      );
      let merged = [...head, ...tail];
      // 服务端的待播数量是准的，本地累积超过它说明有歌被别人删掉了，砍掉尾部多出来的
      if (this.waitSongCount > 0 && merged.length > this.waitSongCount) {
        merged = merged.slice(0, this.waitSongCount);
      }
      const key = merged.map((item) => `${item.songId}:${item.bizId}`).join(",");
      const oldKey = this.queueSongs.map((item) => `${item.songId}:${item.bizId}`).join(",");
      this.queueSongs = merged;
      this.roomTrackIds = merged.map((item) => item.songId);
      if (key !== oldKey) void this.fetchQueueTracks();
    },
    /** 拉取队列歌曲详情 */
    async fetchQueueTracks() {
      const ids = this.queueSongs.map((item) => item.songId);
      if (!ids.length) {
        this.queueTracks = [];
        return;
      }
      try {
        const result = await songDetail(ids);
        const byId = new Map(formatSongsList(result?.songs ?? []).map((song) => [song.id, song]));
        // 严格按房间队列顺序排列，避免接口返回顺序打乱列表
        this.queueTracks = this.queueSongs
          .map((item) => byId.get(item.songId))
          .filter((song): song is SongType => Boolean(song));
        this.syncRoomPlayList();
      } catch (error) {
        console.warn("获取一起听队列失败：", error);
      }
    },
    /**
     * 顶歌：把队列里的歌提到更靠前的位置
     * @param songId 歌曲 ID
     */
    async upSong(songId: number) {
      if (!this.inRoom || !this.roomId) return false;
      const target = this.queueSongs.find((item) => item.songId === songId);
      if (!target?.bizId) {
        window.$message.warning("这首歌不在房间队列里");
        return false;
      }
      try {
        const result = await multiListenOperate({
          roomId: this.roomId,
          songId,
          bizId: target.bizId,
          operate: MULTI_SONG_OPERATE.UP,
        });
        const data = result?.data;
        const failed =
          data?.result === false ||
          (typeof data?.failedCode === "number" && data.failedCode !== 0);
        if (!result || result.code !== 200 || failed) {
          window.$message.warning(data?.failedMsg || "顶歌失败");
          return false;
        }
        if (typeof data?.roomSongInfo?.waitSongCount === "number") {
          this.waitSongCount = data.roomSongInfo.waitSongCount;
        }
        if (data?.roomSongInfo?.nextSongs) {
          this.setQueue(
            data.roomSongInfo.nextSongs.map((song) => ({
              songId: toId(song.songId),
              bizId: toId(song.songBizId),
            })),
          );
        }
        window.$message.success("已顶歌");
        return true;
      } catch (error) {
        console.warn("顶歌失败：", error);
        return false;
      }
    },
    /**
     * 发起切歌，服务端按「不想听」的人数决定是否真的切换
     */
    async requestSkip() {
      if (!this.inRoom || !this.roomId || !this.currentTrackId) return false;
      try {
        const result = await multiListenOperate({
          roomId: this.roomId,
          songId: this.currentTrackId,
          bizId: this.currentSongBizId || 0,
          operate: MULTI_SONG_OPERATE.SWITCH,
        });
        if (!result || result.code !== 200) {
          window.$message.warning(result?.message || "切歌请求失败");
          return false;
        }
        const data = result.data;
        const failed =
          data?.result === false ||
          (typeof data?.failedCode === "number" && data.failedCode !== 0);
        if (failed) {
          window.$message.info(data?.failedMsg || "还没凑够人同意切歌");
          return false;
        }
        window.$message.success(data?.failedMsg || "切歌成功");
        this.appliedRemoteKey = "";
        await this.refreshRoom(true);
        return true;
      } catch (error) {
        console.warn("切歌失败：", error);
        return false;
      }
    },
    /** 远端状态静默期，避免同步回环 */
    holdRemoteSilence() {
      if (remoteSilenceTimer !== null) {
        window.clearTimeout(remoteSilenceTimer);
      }
      remoteSilenceTimer = window.setTimeout(() => {
        this.isApplyingRemote = false;
        remoteSilenceTimer = null;
      }, REMOTE_SILENCE_DURATION);
    },
    /** 发送心跳，顺带校正进度 */
    async sendHeartbeat() {
      if (!this.inRoom || !this.roomId) return;
      try {
        const result = await multiListenHeartbeat(this.roomId);
        if (result?.code === 488) {
          this.handleRoomOffline(result.message || "一起听房间已失效");
          return;
        }
        const data = result?.data;
        if (!data) return;
        const playInfo = data.roomPlaySongInfo;
        if (playInfo) {
          if (typeof playInfo.waitSongCount === "number") {
            this.waitSongCount = playInfo.waitSongCount;
          }
          const trackId = toId(playInfo.playSong?.songId);
          if (trackId) {
            this.currentSongBizId = toId(playInfo.playSong?.songBizId) || this.currentSongBizId;
            this.remoteProgress = readProgress(playInfo);
            this.progressSampledAt = Date.now();
            this.remoteDuration = Number(playInfo.songDuration ?? 0) || this.remoteDuration;
            if (trackId !== this.currentTrackId) {
              this.currentTrackId = trackId;
              await this.loadTrackInfo(trackId);
              await this.applyPlayback(trackId, this.remoteProgress);
            }
          }
        }
        const duration = Number(data.heartBeatDuration ?? 0);
        if (duration > 0 && duration * 1000 !== this.heartbeatDuration) {
          this.heartbeatDuration = duration * 1000;
          this.restartHeartbeat();
        }
        this.lastSyncTime = Date.now();
      } catch (error) {
        console.warn("一起听心跳失败：", error);
      }
    },
    /**
     * 把本地播放列表并入房间歌单
     * @param limit 单次最多补充的歌曲数
     */
    async syncPlaylistToRoom(limit = 30) {
      if (!this.inRoom || !this.roomId) return 0;
      const dataStore = useDataStore();
      const ids = dataStore.playList.map((song) => song.id).filter((id) => id > 0);
      const known = new Set([this.currentTrackId, ...this.roomTrackIds]);
      const pending = [...new Set(ids)].filter((id) => !known.has(id)).slice(0, limit);
      if (!pending.length) return 0;
      let added = 0;
      for (const id of pending) {
        if (this.addCooldownRemain > 0) break;
        if (await this.addSongToRoom(id, true)) added += 1;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (added > 0) {
        window.$message.success(
          this.addCooldownRemain > 0
            ? `向房间歌单补充了 ${added} 首，点歌有 ${this.addCooldownRemain} 秒冷却`
            : `已向房间歌单补充 ${added} 首`,
        );
      }
      return added;
    },
    /**
     * 加载歌曲信息
     * @param trackId 歌曲 ID
     */
    async loadTrackInfo(trackId: number): Promise<SongType | null> {
      if (this.currentTrack?.id === trackId) return this.currentTrack;
      try {
      const result = await songDetail(trackId);
        const song = formatSongsList(result?.songs ?? [])[0] ?? null;
        if (song && this.currentTrackId === trackId) {
          this.currentTrack = song;
          this.syncRoomPlayList();
        }
        return song;
      } catch (error) {
        console.warn("获取一起听歌曲信息失败：", error);
        return null;
      }
    },
    /**
     * 房间失效处理
     * @param reason 原因
     */
    handleRoomOffline(reason: string) {
      this.stopTimers();
      this.stopPlayerWatchers();
      this.resetRoom();
      if (!offlineNoticeShown) {
        offlineNoticeShown = true;
        window.$message.warning(reason || "一起听房间已失效");
      }
    },
  },
});
