import request from "@/utils/request";
import { getListenDeviceId } from "@/utils/device";

/** 通用响应 */
export interface MultiListenResponse<T> {
  code: number;
  message?: string;
  data: T;
}

/** 房间内歌曲条目 */
export interface MultiListenSong {
  songId: number;
  songBizId: number;
  songRcmdUid?: number;
  rcmdType?: number;
}

/** 房间播放信息 */
export interface MultiListenPlayInfo {
  /** 开始播放的时间戳 */
  startTime?: number;
  /** 已播放时长（毫秒） */
  playedTime?: number;
  /** 歌曲总时长（毫秒） */
  songDuration?: number;
  /** 当前歌曲 */
  playSong?: MultiListenSong;
  /** 下一批歌曲 */
  nextSongs?: MultiListenSong[];
  /** 列表版本 */
  version?: number;
  /** 待播数量 */
  waitSongCount?: number;
  /** 当前曲目的点赞数 */
  playingSongZanCnt?: number;
  /** 是否需要强制同步 */
  forceSync?: boolean;
}

/** 房间在线用户 */
export interface MultiListenUserInfo {
  uid: number;
  nickname?: string;
  avatar?: string;
}

/** 在线用户聚合 */
export interface MultiListenUserAgg {
  onlineNums?: number;
  onlineUserInfos?: MultiListenUserInfo[];
  currentSongBizId?: number;
  nextSongBizId?: number;
  version?: number;
}

/** 房间信息 */
export interface MultiListenRoomInfo {
  roomId?: string;
  creatorId?: number;
  firstUserId?: number;
  chatRoomId?: string;
  roomType?: string;
  /** 房间业务类型：1 双人，2 多人 */
  roomBizType?: number;
  roomStatus?: number;
  roomClosed?: boolean;
  roomCreateTime?: number;
  roomEndOrpheus?: string;
}

/** 房间快照 */
export interface MultiListenSnapshot {
  roomId: string;
  multiRoomInfoDTO?: MultiListenRoomInfo;
  multiLtRoomUserAgg?: MultiListenUserAgg;
  roomPlaySongInfo?: MultiListenPlayInfo;
  roomTagList?: unknown;
}

/** 房间状态 */
export interface MultiListenStatusData {
  status?: string;
  multiLtRoomSnapshot?: MultiListenSnapshot;
  leaveRoomTitle?: string;
  nextAddSongDuration?: number;
  realOnlineTime?: number;
}

/** 心跳返回 */
export interface MultiListenHeartbeatData {
  roomPlaySongInfo?: MultiListenPlayInfo;
  heartBeatDuration?: number;
  roomInfoDTO?: MultiListenRoomInfo;
}

/** 歌曲操作返回 */
export interface MultiListenOperateData {
  result?: boolean;
  failedMsg?: string;
  failedCode?: number;
  roomSongInfo?: MultiListenPlayInfo;
}

/** 歌曲操作类型 */
export const MULTI_SONG_OPERATE = {
  JOIN: 0,
  ADD: 1,
  UP: 2,
  LIKE: 3,
  SWITCH: 4,
  REDHEART: 5,
} as const;

/** 查询当前多人房间状态 */
export const multiListenStatus = () => {
  return request<MultiListenResponse<MultiListenStatusData>>({
    baseURL: "/api/multilisten",
    url: "/status",
    method: "post",
    data: {},
  });
};

/**
 * 创建多人房间
 * @param songId 初始歌曲 ID
 */
export const multiListenCreate = (songId: number | string, roomType: 1 | 2 = 2) => {
  return request<MultiListenResponse<Record<string, unknown>>>({
    baseURL: "/api/multilisten",
    url: "/create",
    method: "post",
    data: { songId, roomType },
  });
};

/**
 * 发送房间心跳
 * @param roomId 房间号
 */
export const multiListenHeartbeat = (roomId: string) => {
  return request<MultiListenResponse<MultiListenHeartbeatData>>({
    baseURL: "/api/multilisten",
    url: "/heartbeat",
    method: "post",
    data: { roomId },
  });
};

/**
 * 加入多人房间
 * @param roomId 房间号
 * @param inviterUid 邀请者 ID
 */
export const multiListenJoin = (roomId: string, inviterUid: number | string) => {
  return request<
    MultiListenResponse<{ success?: boolean; multiLtRoomSnapshot?: MultiListenSnapshot }>
  >({
    baseURL: "/api/multilisten",
    url: "/join",
    method: "post",
    data: { roomId, inviterUid, deviceId: getListenDeviceId() },
  });
};

/**
 * 房间歌曲操作
 * @param params 操作参数
 */
export const multiListenOperate = (params: {
  roomId: string;
  songId: number | string;
  bizId?: number | string;
  operate?: number;
}) => {
  return request<MultiListenResponse<MultiListenOperateData>>({
    baseURL: "/api/multilisten",
    url: "/operate",
    method: "post",
    data: {
      deviceId: getListenDeviceId(),
      operate: MULTI_SONG_OPERATE.SWITCH,
      bizId: 0,
      ...params,
    },
  });
};

/**
 * 退出多人房间
 * @param roomId 房间号
 */
export const multiListenExit = (roomId: string) => {
  return request<MultiListenResponse<unknown>>({
    baseURL: "/api/multilisten",
    url: "/exit",
    method: "post",
    data: { roomId, exitType: "NORMAL_END" },
  });
};
