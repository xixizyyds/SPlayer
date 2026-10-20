/** 一起听设备标识存储键 */
const DEVICE_KEY = "listen-together-device-id";

/**
 * 获取稳定的设备标识，官方多人接口要求带上
 */
export const getListenDeviceId = (): string => {
  try {
    const cached = localStorage.getItem(DEVICE_KEY);
    if (cached) return cached;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
};
