import {
  listenTogetherAccept,
  listenTogetherCheckRoom,
  listenTogetherCloseRoom,
  listenTogetherCreateRoom,
  listenTogetherGetPlaylist,
  listenTogetherGetStatus,
  listenTogetherHeartbeat,
  listenTogetherSyncListCommand,
  listenTogetherSyncPlayCommand,
  type ListenTogetherPlayCommandType,
  type ListenTogetherRoomInfo,
  type ListenTogetherUser,
} from "@/api/listentogether";
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
const ROOM_REFRESH_INTERVAL = 5000;
/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 30000;
/** 应用远端状态后的静默时长（毫秒） */
const REMOTE_SILENCE_DURATION = 4000;

/** 播放器状态监听 */
let playerWatchers: Array<ReturnType<typeof watch>> = [];
/** 远端状态静默定时器 */
let remoteSilenceTimer: number | null = null;
/** 房间失效提示是否已展示 */
let offlineNoticeShown = false;

interface ListenTogetherState {
  /** 房间号 */
  roomId: string;
  /** 邀请者 ID（房主） */
  inviterId: number;
  /** 是否为房主 */
  isCreator: boolean;
  /** 是否在房间中 */
  inRoom: boolean;
  /** 在线成员 */
  members: ListenTogetherUser[];
  /** 房间状态文案 */
  roomStatusText: string;
  /** 是否跟随房间播放 */
  followEnabled: boolean;
  /** 分享链接中的歌曲 ID */
  shareSongId: number;
  /** 房间当前曲目 ID */
  currentTrackId: number;
  /** 房间当前曲目 */
  currentTrack: SongType | null;
  /** 房间播放状态 */
  remotePlayStatus: "PLAY" | "PAUSE";
  /** 房间播放进度（毫秒） */
  remoteProgress: number;
  /** 房间播放列表 ID */
  roomTrackIds: number[];
  /** 上次同步时间 */
  lastSyncTime: number;
  /** 播放列表版本号 */
  listVersion: number;
  /** 客户端指令序号 */
  clientSeq: number;
  /** 是否正在应用远端状态 */
  isApplyingRemote: boolean;
  /** 已应用的远端状态标识 */
  appliedRemoteKey: string;
  /** 房间状态定时器 */
  roomTimer: number | null;
  /** 心跳定时器 */
  heartbeatTimer: number | null;
  /** 是否正在刷新房间 */
  refreshing: boolean;
  /** 房间状态查询计数 */
  roomCheckTick: number;
}

/** 转为对象 */
const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

/** 转为歌曲 ID */
const toTrackId = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 0;
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : 0;
};

/** 标准化在线成员 */
const normalizeMembers = (roomInfo: ListenTogetherRoomInfo): ListenTogetherUser[] => {
  const raw = roomInfo.roomUsers ?? (roomInfo as Record<string, unknown>).users;
  const list = Array.isArray(raw) ? raw : [];
  const members = list
    .map((item) => {
      const record = asRecord(item);
      const userId = toTrackId(record.userId ?? record.id);
      const nickname = String(
        record.nickName ?? record.nickname ?? record.name ?? record.userName ?? "",
      );
      const avatarUrl = String(record.avatarUrl ?? record.avatar ?? record.picUrl ?? "");
      return { userId, nickname, avatarUrl };
    })
    .filter((item) => item.userId > 0);
  // 去重
  return [...new Map(members.map((item) => [item.userId, item])).values()];
};

/** 解析房间播放信息 */
const readRoomPlayback = (roomInfo: ListenTogetherRoomInfo) => {
  const playing = asRecord(roomInfo.playingInfo);
  const trackId = toTrackId(
    roomInfo.songId ?? roomInfo.trackId ?? playing.songId ?? playing.trackId,
  );
  const rawStatus = String(
    roomInfo.playStatus ?? playing.playStatus ?? playing.status ?? "",
  ).toUpperCase();
  const playStatus: "PLAY" | "PAUSE" | undefined =
    rawStatus === "PAUSE" ? "PAUSE" : rawStatus === "PLAY" ? "PLAY" : undefined;
  const progress = Number(roomInfo.progress ?? playing.progress ?? playing.currentTime);
  return {
    trackId,
    playStatus,
    progress: Number.isFinite(progress) && progress >= 0 ? progress : 0,
  };
};

/** 房间状态文案 */
const formatRoomStatus = (status?: string): string => {
  switch (status) {
    case "AVAILABLE":
      return "房间可用";
    case "ROOM_NOT_FOUND":
      return "房间不存在";
    case "ROOM_CLOSED":
      return "房间已关闭";
    default:
      return status ? `房间状态：${status}` : "";
  }
};

export const useListenTogetherStore = defineStore("listenTogether", {
  state: (): ListenTogetherState => ({
    roomId: "",
    inviterId: 0,
    isCreator: false,
    inRoom: false,
    members: [],
    roomStatusText: "",
    followEnabled: true,
    shareSongId: 0,
    currentTrackId: 0,
    currentTrack: null,
    remotePlayStatus: "PLAY",
    remoteProgress: 0,
    roomTrackIds: [],
    lastSyncTime: 0,
    listVersion: 0,
    clientSeq: 0,
    isApplyingRemote: false,
    appliedRemoteKey: "",
    roomTimer: null,
    heartbeatTimer: null,
    refreshing: false,
    roomCheckTick: 0,
  }),
  getters: {
    /** 邀请链接 */
    shareLink(state): string {
      if (!state.roomId) return "";
      const songId = state.shareSongId || state.currentTrackId || 0;
      return `https://st.music.163.com/listen-together/share/?songId=${songId}&roomId=${state.roomId}&inviterId=${state.inviterId}`;
    },
    /** 在线人数 */
    memberCount(state): number {
      return state.members.length;
    },
  },
  actions: {
    /** 创建房间 */
    async createRoom() {
      if (!isLogin()) {
        window.$message.warning("请先登录网易云账号");
        return false;
      }
      const musicStore = useMusicStore();
      try {
        const result = await listenTogetherCreateRoom();
        const roomInfo = result?.data?.roomInfo;
        if (result?.code !== 200 || !roomInfo?.roomId) {
          window.$message.error(result?.message || "创建一起听房间失败");
          return false;
        }
        this.roomId = String(roomInfo.roomId);
        this.inviterId = Number(roomInfo.creatorId || useDataStore().userData.userId || 0);
        this.isCreator = true;
        this.inRoom = true;
        this.followEnabled = true;
        this.shareSongId = musicStore.playSong.id;
        this.currentTrackId = musicStore.playSong.id;
        this.currentTrack = musicStore.playSong.id ? musicStore.playSong : null;
        this.appliedRemoteKey = "";
        offlineNoticeShown = false;
        this.startTimers();
        this.startPlayerWatchers();
        await this.refreshRoom(true);
        await this.syncPlaylistToRoom();
        window.$message.success("一起听房间已创建");
        return true;
      } catch (error) {
        console.error("创建一起听房间失败：", error);
        window.$message.error("创建一起听房间失败");
        return false;
      }
    },
    /**
     * 加入房间
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
        const result = await listenTogetherAccept(safeRoomId, safeInviterId);
        if (!result || result.code !== 200) {
          window.$message.error(result?.message || "加入一起听房间失败");
          return false;
        }
        this.roomId = safeRoomId;
        this.inviterId = safeInviterId;
        this.isCreator = useDataStore().userData.userId === safeInviterId;
        this.inRoom = true;
        this.followEnabled = true;
        this.shareSongId = useMusicStore().playSong.id;
        this.currentTrackId = 0;
        this.currentTrack = null;
        this.remoteProgress = 0;
        this.appliedRemoteKey = "";
        offlineNoticeShown = false;
        this.startTimers();
        this.startPlayerWatchers();
        await this.refreshRoom(true);
        await this.fetchRoomPlaylist();
        window.$message.success("已加入一起听房间");
        return true;
      } catch (error) {
        console.error("加入一起听房间失败：", error);
        window.$message.error("加入一起听房间失败");
        return false;
      }
    },
    /**
     * 离开房间
     * @param close 是否关闭房间（仅房主）
     */
    async leaveRoom(close = false) {
      const roomId = this.roomId;
      const canClose = close && this.isCreator && !!roomId;
      this.stopTimers();
      this.stopPlayerWatchers();
      if (canClose) {
        try {
          const result = await listenTogetherCloseRoom(roomId);
          if (!result || result.code !== 200) {
            window.$message.warning("关闭一起听房间失败，已本地退出");
          }
        } catch (error) {
          console.warn("关闭一起听房间失败：", error);
        }
      }
      this.resetRoom();
      window.$message.success(canClose ? "一起听房间已关闭" : "已退出一起听房间");
    },
    /** 重置房间状态 */
    resetRoom() {
      this.roomId = "";
      this.inviterId = 0;
      this.isCreator = false;
      this.inRoom = false;
      this.members = [];
      this.roomStatusText = "";
      this.followEnabled = true;
      this.shareSongId = 0;
      this.currentTrackId = 0;
      this.currentTrack = null;
      this.remotePlayStatus = "PLAY";
      this.remoteProgress = 0;
      this.roomTrackIds = [];
      this.lastSyncTime = 0;
      this.appliedRemoteKey = "";
      this.roomCheckTick = 0;
      this.isApplyingRemote = false;
      this.refreshing = false;
    },
    /** 开始房间定时任务 */
    startTimers() {
      this.stopTimers();
      this.roomTimer = window.setInterval(() => {
        void this.refreshRoom();
      }, ROOM_REFRESH_INTERVAL);
      this.heartbeatTimer = window.setInterval(() => {
        void this.sendHeartbeat();
      }, HEARTBEAT_INTERVAL);
      void this.sendHeartbeat();
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
    /** 监听播放器状态变化 */
    startPlayerWatchers() {
      this.stopPlayerWatchers();
      const statusStore = useStatusStore();
      const musicStore = useMusicStore();
      playerWatchers.push(
        watch(
          () => musicStore.playSong.id,
          (newId, oldId) => {
            if (!this.inRoom || !this.followEnabled || this.isApplyingRemote) return;
            if (!newId || newId === oldId) return;
            void this.reportPlayState("GOTO", { songId: newId, progress: 0 });
          },
        ),
        watch(
          () => statusStore.playStatus,
          (playing, wasPlaying) => {
            if (!this.inRoom || !this.followEnabled || this.isApplyingRemote) return;
            if (playing === wasPlaying) return;
            void this.reportPlayState(playing ? "PLAY" : "PAUSE");
          },
        ),
      );
    },
    /** 停止监听播放器状态 */
    stopPlayerWatchers() {
      playerWatchers.forEach((stop) => stop());
      playerWatchers = [];
    },
    /**
     * 刷新房间状态
     * @param force 是否强制应用远端播放状态
     */
    async refreshRoom(force = false) {
      if (!this.inRoom || !this.roomId || this.refreshing) return;
      this.refreshing = true;
      try {
        const result = await listenTogetherGetStatus();
        if (!result) return;
        const data = result.data;
        if (result.code !== 200 || !data || data.inRoom === false) {
          this.handleRoomOffline(result.message || "一起听房间已失效");
          return;
        }
        const roomInfo = data.roomInfo ?? {};
        this.members = normalizeMembers(roomInfo);
        this.lastSyncTime = Date.now();
        // 定时校验房间是否仍然可用
        this.roomCheckTick += 1;
        if (this.roomCheckTick % 3 === 0) {
          const check = await listenTogetherCheckRoom(this.roomId);
          this.roomStatusText = formatRoomStatus(check?.data?.status);
          const status = check?.data?.status;
          if (status === "ROOM_NOT_FOUND" || status === "ROOM_CLOSED") {
            this.handleRoomOffline(check?.data?.copywriting || "一起听房间已关闭");
            return;
          }
        }
        await this.applyRoomPlayback(roomInfo, force);
      } catch (error) {
        console.warn("刷新一起听房间失败：", error);
      } finally {
        this.refreshing = false;
      }
    },
    /**
     * 应用房间播放状态
     * @param roomInfo 房间信息
     * @param force 是否强制执行
     */
    async applyRoomPlayback(roomInfo: ListenTogetherRoomInfo, force = false) {
      const { trackId, playStatus, progress } = readRoomPlayback(roomInfo);
      if (!trackId) return;
      this.currentTrackId = trackId;
      if (playStatus) this.remotePlayStatus = playStatus;
      if (progress > 0) this.remoteProgress = progress;
      await this.loadTrackInfo(trackId);
      if (!this.followEnabled) return;
      const key = `${trackId}:${playStatus ?? ""}:${Math.floor(progress / 5000)}`;
      if (!force && key === this.appliedRemoteKey) return;
      this.appliedRemoteKey = key;
      this.isApplyingRemote = true;
      try {
        const { usePlayerController } = await import("@/core/player/PlayerController");
        const player = usePlayerController();
        const musicStore = useMusicStore();
        const shouldPlay = (playStatus ?? this.remotePlayStatus) !== "PAUSE";
        if (musicStore.playSong.id !== trackId) {
          const song = this.currentTrack ?? (await this.loadTrackInfo(trackId));
          if (song) {
            await player.playSong({ song, seek: progress, autoPlay: shouldPlay });
          }
        } else {
          if (shouldPlay) await player.play();
          else await player.pause();
          if (progress > 0 && Math.abs(player.getSeek() - progress) > 3000) {
            player.setSeek(progress);
          }
        }
      } catch (error) {
        console.warn("应用一起听播放状态失败：", error);
      } finally {
        this.holdRemoteSilence();
      }
    },
    /** 应用一次当前房间播放状态 */
    async applyRoomPlaybackNow() {
      const result = await listenTogetherGetStatus();
      const roomInfo = result?.data?.roomInfo;
      if (!roomInfo) {
        window.$message.warning("暂未获取到房间播放信息");
        return;
      }
      await this.applyRoomPlayback(roomInfo, true);
      window.$message.success("已同步房间播放状态");
    },
    /** 推送当前歌曲到房间 */
    async pushCurrentSong() {
      if (!this.inRoom) return;
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();
      if (!musicStore.playSong.id) {
        window.$message.warning("当前没有播放中的歌曲");
        return;
      }
      await this.reportPlayState("GOTO", {
        songId: musicStore.playSong.id,
        progress: statusStore.currentTime,
      });
      window.$message.success("已推送当前歌曲");
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
    /**
     * 上报播放状态
     * @param commandType 指令类型
     * @param options 附加参数
     */
    async reportPlayState(
      commandType: ListenTogetherPlayCommandType,
      options: { songId?: number; progress?: number; playStatus?: "PLAY" | "PAUSE" } = {},
    ) {
      if (!this.inRoom || !this.roomId || this.isApplyingRemote) return;
      const statusStore = useStatusStore();
      const musicStore = useMusicStore();
      const songId = options.songId ?? musicStore.playSong.id;
      if (!songId) return;
      const playStatus = options.playStatus ?? (statusStore.playStatus ? "PLAY" : "PAUSE");
      const progress = Math.floor(options.progress ?? statusStore.currentTime);
      this.clientSeq += 1;
      this.currentTrackId = songId;
      this.remotePlayStatus = playStatus;
      this.remoteProgress = progress;
      if (this.currentTrack?.id !== songId) {
        void this.loadTrackInfo(songId);
      }
      try {
        await listenTogetherSyncPlayCommand({
          roomId: this.roomId,
          commandType,
          progress,
          playStatus,
          formerSongId: "-1",
          targetSongId: String(songId),
          clientSeq: this.clientSeq,
        });
        this.lastSyncTime = Date.now();
      } catch (error) {
        console.warn("同步一起听播放状态失败：", error);
      }
    },
    /** 发送心跳 */
    async sendHeartbeat() {
      if (!this.inRoom || !this.roomId) return;
      const statusStore = useStatusStore();
      const musicStore = useMusicStore();
      const songId = musicStore.playSong.id || this.currentTrackId;
      if (!songId) return;
      try {
        await listenTogetherHeartbeat({
          roomId: this.roomId,
          songId,
          playStatus: statusStore.playStatus ? "PLAY" : "PAUSE",
          progress: Math.floor(statusStore.currentTime),
        });
        this.lastSyncTime = Date.now();
      } catch (error) {
        console.warn("一起听心跳失败：", error);
      }
    },
    /** 同步当前播放列表到房间 */
    async syncPlaylistToRoom() {
      if (!this.inRoom || !this.roomId) return 0;
      const dataStore = useDataStore();
      const userId = dataStore.userData.userId;
      const ids = dataStore.playList.map((song) => song.id).filter((id) => id > 0);
      if (!ids.length || !userId) {
        window.$message.warning("当前播放列表为空，暂无法同步");
        return 0;
      }
      const list = ids.join(",");
      this.listVersion += 1;
      try {
        const result = await listenTogetherSyncListCommand({
          roomId: this.roomId,
          commandType: "REPLACE",
          userId,
          version: this.listVersion,
          displayList: list,
          randomList: list,
        });
        if (!result || result.code !== 200) {
          window.$message.warning(result?.message || "同步播放列表失败");
          return 0;
        }
        this.roomTrackIds = ids;
        this.lastSyncTime = Date.now();
        return ids.length;
      } catch (error) {
        console.warn("同步一起听播放列表失败：", error);
        return 0;
      }
    },
    /** 获取房间播放列表 */
    async fetchRoomPlaylist() {
      if (!this.inRoom || !this.roomId) return;
      try {
        const result = await listenTogetherGetPlaylist(this.roomId);
        const displayList = result?.data?.playlist?.displayList;
        const raw = Array.isArray(displayList) ? displayList : displayList?.result;
        const ids = (Array.isArray(raw) ? raw : [])
          .map((id) => toTrackId(id))
          .filter((id) => id > 0);
        this.roomTrackIds = [...new Set(ids)];
      } catch (error) {
        console.warn("获取一起听播放列表失败：", error);
      }
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
        if (song) this.currentTrack = song;
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
