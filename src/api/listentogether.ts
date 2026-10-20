import request from "@/utils/request";

/** 一起听接口通用响应 */
export interface ListenTogetherResponse<T> {
  /** 状态码 */
  code: number;
  /** 提示信息 */
  message?: string;
  /** 业务数据 */
  data: T;
}

/** 创建房间返回的房间信息 */
export interface ListenTogetherCreatedRoom {
  /** 创建者 ID */
  creatorId: number;
  /** 房间号 */
  roomId: string;
}

/** 创建房间返回数据 */
export interface ListenTogetherCreateRoomData {
  /** 房间类型 */
  type?: string;
  /** 房间信息 */
  roomInfo?: ListenTogetherCreatedRoom;
  /** 提示文案 */
  hintText?: string | null;
  /** 顶部提示文案 */
  toastText?: string | null;
}

/** 房间状态数据 */
export interface ListenTogetherRoomCheckData {
  /** 是否可加入 */
  joinable?: boolean;
  /** 房间类型 */
  type?: string;
  /** 房间状态 */
  status?: string;
  /** 状态提示文案 */
  copywriting?: string | null;
}

/** 房间在线用户 */
export interface ListenTogetherUser {
  /** 用户 ID */
  userId: number;
  /** 用户昵称 */
  nickname?: string;
  /** 服务端昵称字段 */
  nickName?: string;
  /** 头像地址 */
  avatarUrl?: string;
}

/**
 * 房间信息
 *
 * 播放相关字段由服务端版本决定，可能不存在，因此均为可选
 */
export interface ListenTogetherRoomInfo {
  /** 房间号 */
  roomId?: string;
  /** 在线用户 */
  roomUsers?: ListenTogetherUser[];
  /** 当前歌曲 ID */
  songId?: number | string;
  /** 当前歌曲 ID（部分版本） */
  trackId?: number | string;
  /** 播放状态 */
  playStatus?: "PLAY" | "PAUSE" | string;
  /** 播放进度（毫秒） */
  progress?: number | string;
  /** 播放信息（部分版本） */
  playingInfo?: Record<string, unknown>;
  /** 其余字段 */
  [key: string]: unknown;
}

/** 一起听状态数据 */
export interface ListenTogetherStatusData {
  /** 是否在房间内 */
  inRoom: boolean;
  /** 房间信息 */
  roomInfo?: ListenTogetherRoomInfo;
}

/** 一起听播放列表 */
export interface ListenTogetherPlaylist {
  /** 展示列表 */
  displayList?: { result?: Array<number | string> } | Array<number | string>;
  /** 随机播放列表 */
  randomList?: Array<number | string>;
  /** 播放模式 */
  playMode?: string;
}

/** 获取播放列表返回数据 */
export interface ListenTogetherPlaylistData {
  /** 播放列表 */
  playlist?: ListenTogetherPlaylist;
}

/** 心跳参数 */
export interface ListenTogetherHeartbeatParams {
  /** 房间号 */
  roomId: string;
  /** 当前歌曲 ID */
  songId: number | string;
  /** 播放状态 */
  playStatus: "PLAY" | "PAUSE";
  /** 播放进度（毫秒） */
  progress: number;
}

/** 播放状态指令类型 */
export type ListenTogetherPlayCommandType = "PLAY" | "PAUSE" | "GOTO" | "seek";

/** 播放状态指令参数 */
export interface ListenTogetherPlayCommandParams {
  /** 房间号 */
  roomId: string;
  /** 指令类型 */
  commandType: ListenTogetherPlayCommandType;
  /** 播放进度（毫秒） */
  progress?: number;
  /** 播放状态 */
  playStatus?: "PLAY" | "PAUSE";
  /** 切换前的歌曲 ID */
  formerSongId?: number | string;
  /** 目标歌曲 ID */
  targetSongId?: number | string;
  /** 客户端指令序号 */
  clientSeq: number;
}

/** 播放列表指令类型 */
export type ListenTogetherListCommandType = "REPLACE" | "PLAYMODE_CHANGE";

/** 播放列表指令参数 */
export interface ListenTogetherListCommandParams {
  /** 房间号 */
  roomId: string;
  /** 指令类型 */
  commandType: ListenTogetherListCommandType;
  /** 当前用户 ID */
  userId: number | string;
  /** 列表版本号 */
  version: number;
  /** 随机播放列表，逗号分隔 */
  randomList: string;
  /** 展示列表，逗号分隔 */
  displayList: string;
}

/** 创建一起听房间 */
export const listenTogetherCreateRoom = () => {
  return request<ListenTogetherResponse<ListenTogetherCreateRoomData>>({
    url: "/listentogether/room/create",
    method: "post",
    params: { timestamp: Date.now() },
  });
};

/**
 * 加入一起听房间
 * @param roomId 房间号
 * @param inviterId 邀请者 ID
 */
export const listenTogetherAccept = (roomId: string, inviterId: number | string) => {
  return request<ListenTogetherResponse<unknown>>({
    url: "/listentogether/accept",
    method: "post",
    params: { timestamp: Date.now() },
    data: { roomId, inviterId },
  });
};

/**
 * 查询房间状态
 * @param roomId 房间号
 */
export const listenTogetherCheckRoom = (roomId: string) => {
  return request<ListenTogetherResponse<ListenTogetherRoomCheckData>>({
    url: "/listentogether/room/check",
    method: "post",
    params: { timestamp: Date.now() },
    data: { roomId },
  });
};

/**
 * 关闭一起听房间
 * @param roomId 房间号
 */
export const listenTogetherCloseRoom = (roomId: string) => {
  // 服务端关闭房间接口为 /listentogether/end
  return request<ListenTogetherResponse<{ success?: boolean }>>({
    url: "/listentogether/end",
    method: "post",
    params: { timestamp: Date.now() },
    data: { roomId },
  });
};

/**
 * 发送一起听心跳
 * @param params 心跳参数
 */
export const listenTogetherHeartbeat = (params: ListenTogetherHeartbeatParams) => {
  // 服务端路由拼写为 heatbeat
  return request<ListenTogetherResponse<unknown>>({
    url: "/listentogether/heatbeat",
    method: "post",
    params: { timestamp: Date.now() },
    data: { ...params },
  });
};

/**
 * 获取当前一起听状态
 */
export const listenTogetherGetStatus = () => {
  return request<ListenTogetherResponse<ListenTogetherStatusData>>({
    url: "/listentogether/status",
    method: "post",
    params: { timestamp: Date.now() },
  });
};

/**
 * 获取房间播放列表
 * @param roomId 房间号
 */
export const listenTogetherGetPlaylist = (roomId: string) => {
  return request<ListenTogetherResponse<ListenTogetherPlaylistData>>({
    url: "/listentogether/sync/playlist/get",
    method: "post",
    params: { timestamp: Date.now() },
    data: { roomId },
  });
};

/**
 * 同步房间播放列表
 * @param params 列表指令参数
 */
export const listenTogetherSyncListCommand = (params: ListenTogetherListCommandParams) => {
  return request<ListenTogetherResponse<unknown>>({
    url: "/listentogether/sync/list/command",
    method: "post",
    params: { timestamp: Date.now() },
    data: { ...params },
  });
};

/**
 * 同步房间播放状态
 * @param params 播放指令参数
 */
export const listenTogetherSyncPlayCommand = (params: ListenTogetherPlayCommandParams) => {
  return request<ListenTogetherResponse<unknown>>({
    url: "/listentogether/play/command",
    method: "post",
    params: { timestamp: Date.now() },
    data: {
      ...params,
      formerSongId: params.formerSongId ?? "-1",
    },
  });
};
