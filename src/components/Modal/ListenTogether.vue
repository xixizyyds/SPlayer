<template>
  <div class="listen-together">
    <!-- 未登录提示 -->
    <n-alert v-if="!loggedIn" type="warning" :bordered="false" title="需要登录">
      一起听依赖网易云账号登录，请先在设置中登录后再使用。
    </n-alert>

    <n-h3 prefix="bar">一起听</n-h3>

    <!-- 未加入房间 -->
    <template v-if="!listenTogetherStore.inRoom">
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">创建房间</span>
          <span class="setting-desc">
            以当前播放的歌曲开房，创建后把链接发给好友即可加入
          </span>
        </div>
        <n-button
          type="primary"
          strong
          secondary
          size="small"
          :loading="creating"
          :disabled="!loggedIn"
          @click="handleCreate"
        >
          创建
        </n-button>
      </div>
      <div class="setting-row column">
        <div class="setting-info">
          <span class="setting-label">加入房间</span>
          <span class="setting-desc">粘贴邀请链接，或手动填写房间号与邀请者 ID</span>
        </div>
        <n-flex vertical :size="8" class="join-form">
          <n-input
            v-model:value="inviteLink"
            placeholder="粘贴邀请链接自动识别"
            clearable
            @update:value="handleInviteInput"
          />
          <n-input v-model:value="joinForm.roomId" placeholder="房间号" clearable />
          <n-input v-model:value="joinForm.inviterId" placeholder="邀请者 ID" clearable />
          <n-button
            type="primary"
            strong
            secondary
            size="small"
            :loading="joining"
            :disabled="!loggedIn"
            @click="handleJoin"
          >
            加入一起听
          </n-button>
        </n-flex>
      </div>
      <n-text depth="3" class="tip">
        多人房间由网易云官方协议同步，同一首歌会在所有人的客户端一起播放。
      </n-text>
    </template>

    <!-- 房间信息 -->
    <template v-else>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">房间</span>
          <span class="setting-desc">{{ listenTogetherStore.roomId }}</span>
        </div>
        <n-tag size="small" :type="roomAvailable ? 'success' : 'default'">
          {{ listenTogetherStore.roomStatusText || "已连接" }}
        </n-tag>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">在线成员</span>
          <span class="setting-desc">共 {{ listenTogetherStore.memberCount }} 人</span>
        </div>
        <n-button size="tiny" secondary @click="handleCopyLink">复制邀请链接</n-button>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">播放模式</span>
          <span class="setting-desc">
            一起听时播放列表只显示房间歌单，退出后还原原来的播放队列
          </span>
        </div>
        <n-tag size="small" type="info">一起听中</n-tag>
      </div>

      <div v-if="listenTogetherStore.members.length" class="member-list">
        <div v-for="user in listenTogetherStore.members" :key="user.userId" class="member">
          <n-avatar round :size="40" :src="user.avatarUrl || undefined">
            {{ (user.nickname || "听").slice(0, 1) }}
          </n-avatar>
          <span class="member-name">{{ user.nickname || `用户 ${user.userId}` }}</span>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">跟随房间播放</span>
          <span class="setting-desc">切换歌曲与进度按房间对齐</span>
        </div>
        <n-switch v-model:value="listenTogetherStore.followEnabled" size="small" />
      </div>

      <div class="setting-row column">
        <div class="setting-info">
          <span class="setting-label">房间播放</span>
          <span class="setting-desc">
            {{ listenTogetherStore.lastSyncTime ? `上次同步 ${lastSyncText}` : "尚未同步" }}
          </span>
        </div>
        <div v-if="listenTogetherStore.currentTrack" class="track">
          <n-avatar round :size="44" :src="currentCover || undefined" />
        <div class="track-info">
            <span class="track-name">{{ listenTogetherStore.currentTrack.name }}</span>
            <span class="track-artist">{{ trackArtists }}</span>
          </div>
          <n-tag size="tiny" :bordered="false" class="zan-count">
            赞 {{ listenTogetherStore.zanCount }}
          </n-tag>
          <span class="track-time">
            {{ msToTime(listenTogetherStore.remoteProgress) }}
          </span>
        </div>
        <n-text v-else depth="3" class="tip">暂无同步曲目</n-text>
        <n-flex :size="8">
          <n-button size="small" secondary :loading="applying" @click="handleApply">
            立即同步
          </n-button>
          <n-button size="small" secondary @click="handleLike">点赞</n-button>
          <n-button size="small" secondary @click="handlePushSong">添加到歌单</n-button>
          <n-button size="small" secondary @click="handleSkip">切歌</n-button>
        </n-flex>
        <n-text depth="3" class="tip">多人房间里切歌要够多人点过，才会真正跳过</n-text>
      </div>

      <div class="setting-row column">
        <div class="setting-info">
          <span class="setting-label">待播队列</span>
          <span class="setting-desc">
            {{ listenTogetherStore.waitSongCount || listenTogetherStore.queueSongs.length }}
            首待播，顶歌可以把它移到更前面
          </span>
        </div>
        <div v-if="listenTogetherStore.queueTracks.length" class="queue">
          <div
            v-for="(track, index) in listenTogetherStore.queueTracks.slice(0, 8)"
            :key="track.id"
            class="queue-item"
          >
            <span class="queue-index">{{ index + 1 }}</span>
            <div class="track-info">
              <span class="queue-name">{{ track.name }}</span>
              <span class="queue-artist">{{ artistsOf(track) }}</span>
            </div>
            <n-button size="tiny" secondary @click="handleUp(track.id)">顶歌</n-button>
          </div>
        </div>
        <n-text v-else depth="3" class="tip">队列还是空的，点歌会自动加进来</n-text>
      </div>

      <n-flex justify="end" :size="8" class="footer">
        <n-button size="small" type="error" secondary @click="handleLeave">
          退出房间
        </n-button>
      </n-flex>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useListenTogetherStore } from "@/stores";
import type { SongType } from "@/types/main";
import { isLogin } from "@/utils/auth";
import { copyData } from "@/utils/helper";
import { msToTime } from "@/utils/time";

const listenTogetherStore = useListenTogetherStore();

const creating = ref(false);
const joining = ref(false);
const applying = ref(false);
const inviteLink = ref("");

// 加入表单
const joinForm = reactive({
  roomId: "",
  inviterId: "",
});

const loggedIn = computed(() => !!isLogin());
const roomAvailable = computed(() => listenTogetherStore.roomStatusText.includes("可用"));

// 当前同步曲目
const currentCover = computed(() => {
  const track = listenTogetherStore.currentTrack;
  return track?.coverSize?.s || track?.cover || "";
});

const trackArtists = computed(() => {
  const artists = listenTogetherStore.currentTrack?.artists;
  if (!artists) return "未知歌手";
  return Array.isArray(artists) ? artists.map((artist) => artist.name).join(" / ") : artists;
});

// 队列歌曲歌手
const artistsOf = (track: SongType) => {
  const artists = track.artists;
  if (!artists) return "未知歌手";
  return Array.isArray(artists) ? artists.map((artist) => artist.name).join(" / ") : artists;
};

// 上次同步时间
const lastSyncText = computed(() => {
  if (!listenTogetherStore.lastSyncTime) return "";
  return new Date(listenTogetherStore.lastSyncTime).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
});

// 创建房间
const handleCreate = async () => {
  creating.value = true;
  try {
    await listenTogetherStore.createRoom();
  } finally {
    creating.value = false;
  }
};

// 解析邀请链接（兼容多人分享页的 inviterUid）
const handleInviteInput = (value: string) => {
  if (!value || !value.includes("roomId=")) return;
  const link = value.trim();
  const roomId = link.match(/[?&]roomId=([^&]+)/)?.[1];
  const inviterId = link.match(/[?&](?:inviterUid|inviterId|inviter)=([^&]+)/)?.[1];
  if (roomId) joinForm.roomId = decodeURIComponent(roomId);
  if (inviterId) joinForm.inviterId = decodeURIComponent(inviterId);
};

// 加入房间
const handleJoin = async () => {
  joining.value = true;
  try {
    await listenTogetherStore.joinRoom(joinForm.roomId, joinForm.inviterId);
  } finally {
    joining.value = false;
  }
};

// 复制邀请链接
const handleCopyLink = () => {
  if (!listenTogetherStore.shareLink) {
    window.$message.warning("暂未生成邀请链接");
    return;
  }
  void copyData(listenTogetherStore.shareLink, "已复制邀请链接");
};

// 手动同步房间播放状态
const handleApply = async () => {
  applying.value = true;
  try {
    await listenTogetherStore.applyRoomPlaybackNow();
  } finally {
    applying.value = false;
  }
};

// 推送当前歌曲
const handlePushSong = async () => {
  await listenTogetherStore.pushCurrentSong();
};

// 顶歌
const handleUp = async (songId: number) => {
  await listenTogetherStore.upSong(songId);
};

// 点赞当前曲目
const handleLike = async () => {
  await listenTogetherStore.likeCurrentSong();
};

// 切歌（需要其他人一起同意）
const handleSkip = async () => {
  await listenTogetherStore.requestSkip();
};

// 离开房间
const handleLeave = async () => {
  await listenTogetherStore.leaveRoom();
};
</script>

<style scoped lang="scss">
.listen-together {
  width: 100%;
  .setting-row {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    padding: 14px 4px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.14);
    &.column {
      flex-direction: column;
      align-items: stretch;
    }
  }
  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .setting-label {
    font-size: 14px;
    font-weight: 500;
  }
  .setting-desc {
    overflow: hidden;
    font-size: 12px;
    color: var(--n-text-color-3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .join-form {
    width: 100%;
  }
  .member-list {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 14px 4px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.14);
  }
  .member {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    width: 64px;
  }
  .member-name {
    width: 100%;
    overflow: hidden;
    font-size: 12px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 6px 0;
  }
  .track-info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .track-name,
  .track-artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track-name {
    font-size: 14px;
    font-weight: 500;
  }
  .track-artist,
  .track-time {
    font-size: 12px;
    color: var(--n-text-color-3);
  }
  .queue {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .queue-item {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid rgba(128, 128, 128, 0.1);
    &:last-child {
      border-bottom: none;
    }
  }
  .queue-index {
    width: 18px;
    font-size: 12px;
    color: var(--n-text-color-3);
    text-align: center;
  }
  .queue-name {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .queue-artist {
    overflow: hidden;
    font-size: 12px;
    color: var(--n-text-color-3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tip {
    font-size: 12px;
    line-height: 1.6;
  }
  .footer {
    margin-top: 12px;
  }
}
</style>
