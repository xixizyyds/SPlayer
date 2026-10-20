import axios from "axios";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { serverLog } from "../../main/logger";

/**
 * 网易云官方「多人一起听」协议
 *
 * 官方 H5 只提供房间预览，真正的同步发生在 App 内：
 * - 房间快照：/api/listen/together/multi/match/status/get
 * - 心跳保活：/api/listen/together/multi/match/heartbeat（返回当前曲目与播放进度）
 * - 加入房间：/api/listen/together/multi/match/ack（需要易盾 checkToken）
 * - 切歌/推歌：/api/listen/together/multi/match/song/operate
 * - 退出房间：/api/listen/together/multi/match/exit
 *
 * 这些接口直接受 Cookie 鉴权，且请求体为普通表单，不需要 weapi/eapi 加密。
 */

const MUSIC_BASE = "https://music.163.com";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const DUN_TOKEN_URL = "https://ac.dun.163yun.com/v3/b?pn=YD00000558929251";
const REQUEST_TIMEOUT = 15000;

/** 歌曲操作枚举 */
export const MULTI_SONG_OPERATE = {
  JOIN: 0,
  ADD: 1,
  UP: 2,
  LIKE: 3,
  SWITCH: 4,
  REDHEART: 5,
} as const;

/** 从 fastify 解析出的 cookie 对象还原请求头 */
const buildCookieHeader = (cookies: Record<string, string> | undefined): string => {
  if (!cookies) return "";
  return Object.entries(cookies)
    .filter(([key, value]) => !!key && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
};

/** 调用官方多人接口 */
const postMultiAPI = async (
  path: string,
  data: Record<string, string | number | boolean>,
  cookie: string,
  extraHeaders: Record<string, string> = {},
) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    params.append(key, String(value));
  }
  const response = await axios.post(`${MUSIC_BASE}${path}`, params.toString(), {
    timeout: REQUEST_TIMEOUT,
    validateStatus: () => true,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": MOBILE_UA,
      Referer: "https://music.163.com/",
      Cookie: cookie,
      ...extraHeaders,
    },
  });
  return response.data as Record<string, unknown>;
};

/** 易盾令牌缓存，批量操作时复用，避免每次都打一次风控接口 */
let cachedToken = "";
let cachedTokenAt = 0;
const TOKEN_TTL = 15000;

/** 获取易盾 checkToken，加入房间时必需 */
const fetchCheckToken = async (): Promise<string> => {
  if (cachedToken && Date.now() - cachedTokenAt < TOKEN_TTL) {
    return cachedToken;
  }
  try {
    const response = await axios.get(DUN_TOKEN_URL, { timeout: REQUEST_TIMEOUT });
    const matched = String(response.data).match(/null\(\[(\d+),\d+,"([^"]+)"\]\)/);
    const token = matched?.[1] === "200" ? (matched[2] ?? "") : "";
    if (token) {
      cachedToken = token;
      cachedTokenAt = Date.now();
    }
    return token;
  } catch (error) {
    serverLog.warn("获取易盾 checkToken 失败：", error);
    return "";
  }
};

/** 统一的接口包装 */
const handle = async (
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  data: Record<string, string | number | boolean>,
  extraHeaders: Record<string, string> = {},
) => {
  const cookie = buildCookieHeader(request.cookies as Record<string, string>);
  if (!cookie.includes("MUSIC_U=")) {
    return reply.code(200).send({ code: 301, message: "未登录网易云账号", data: null });
  }
  try {
    const result = await postMultiAPI(path, data, cookie, extraHeaders);
    return reply.send(result);
  } catch (error) {
    serverLog.error("多人一起听请求失败：", error);
    return reply.code(200).send({
      code: 500,
      message: error instanceof Error ? error.message : "多人一起听请求失败",
      data: null,
    });
  }
};

/** 读取请求体字段 */
const readBody = (request: FastifyRequest): Record<string, unknown> => {
  return (request.body ?? {}) as Record<string, unknown>;
};

/** 转为有效的歌曲 ID */
const toSongId = (value: unknown): number => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : 0;
};

/**
 * 多人一起听接口
 * @param fastify Fastify 实例
 */
export const initMultiListenAPI = async (fastify: FastifyInstance) => {
  await fastify.register(async (fastify) => {
    // 当前房间快照（包含成员、当前曲目、进度、歌单）
    fastify.post("/status", async (request, reply) => {
      return handle(request, reply, "/api/listen/together/multi/match/status/get", {});
    });

    // 心跳，同时也会带回房间当前播放信息
    fastify.post("/heartbeat", async (request, reply) => {
      const { roomId } = readBody(request);
      if (!roomId) return reply.send({ code: 400, message: "缺少房间号", data: null });
      return handle(request, reply, "/api/listen/together/multi/match/heartbeat", {
        roomId: String(roomId),
      });
    });

    // 加入房间
    fastify.post("/join", async (request, reply) => {
      const { roomId, inviterUid, deviceId } = readBody(request);
      if (!roomId || !inviterUid) {
        return reply.send({ code: 400, message: "缺少房间号或邀请者 ID", data: null });
      }
      const checkToken = await fetchCheckToken();
      if (!checkToken) {
        return reply.send({ code: 400, message: "获取校验令牌失败，请稍后重试", data: null });
      }
      return handle(request, reply, "/api/listen/together/multi/match/ack", {
        roomId: String(roomId),
        agree: true,
        inviterUid: String(inviterUid),
        checkToken,
        deviceId: String(deviceId ?? ""),
      });
    });

    // 创建房间（type=1 双人，type=2 多人）
    fastify.post("/create", async (request, reply) => {
      const { songId, roomType } = readBody(request);
      const safeSongId = toSongId(songId);
      if (!safeSongId) {
        return reply.send({ code: 400, message: "创建房间需要一首有效的歌曲", data: null });
      }
      const checkToken = await fetchCheckToken();
      if (!checkToken) {
        return reply.send({ code: 400, message: "获取校验令牌失败，请稍后重试", data: null });
      }
      return handle(request, reply, "/api/listen/together/multi/room/create", {
        type: Number(roomType) === 1 ? 1 : 2,
        songId: safeSongId,
        groupIds: "[]",
        inviteUids: "[]",
        checkToken,
      });
    });

    // 切歌 / 推歌 / 点赞
    fastify.post("/operate", async (request, reply) => {
      const { roomId, songId, bizId, operate } = readBody(request);
      if (!roomId || songId === undefined) {
        return reply.send({ code: 400, message: "缺少房间号或歌曲 ID", data: null });
      }
      const operateCode = Number(operate ?? MULTI_SONG_OPERATE.SWITCH);
      const { deviceId } = readBody(request);
      // 切歌与推歌属于写操作，带上易盾令牌更稳，拿不到也不阻塞
      const checkToken =
        operateCode === MULTI_SONG_OPERATE.SWITCH || operateCode === MULTI_SONG_OPERATE.ADD
          ? await fetchCheckToken()
          : "";
      return handle(
        request,
        reply,
        "/api/listen/together/multi/match/song/operate",
        {
          roomId: String(roomId),
          songId: String(songId),
          bizId: String(bizId ?? 0),
          operate: operateCode,
          deviceId: String(deviceId ?? ""),
        },
        checkToken ? { "X-antiCheatToken": checkToken } : {},
      );
    });

    // 退出房间
    fastify.post("/exit", async (request, reply) => {
      const { roomId, exitType } = readBody(request);
      if (!roomId) return reply.send({ code: 400, message: "缺少房间号", data: null });
      return handle(request, reply, "/api/listen/together/multi/match/exit", {
        roomId: String(roomId),
        exitType: String(exitType ?? "NORMAL_END"),
      });
    });
  }, { prefix: "/multilisten" });
};
