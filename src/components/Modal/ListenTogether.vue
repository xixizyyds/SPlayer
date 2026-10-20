<template>
  <n-flex class="listen-together" :size="16" vertical>
    <!-- 未登录提示 -->
    <n-alert v-if="!loggedIn" type="warning" :bordered="false" title="需要登录">
      一起听依赖网易云账号登录，请先在设置中登录后再使用。
    </n-alert>

    <!-- 未加入房间 -->
    <template v-if="!listenTogetherStore.inRoom">
      <n-card size="small">
        <template #header>
          <n-flex align="center" :size="8">
            <SvgIcon name="PlayCircle" :size="20" />
            <n-text strong>创建房间</n-text>
          </n-flex>
        </template>
        <n-flex vertical :size="12">
          <n-text depth="3">创建后可以把邀请链接发给好友，或让对方使用房间号加入。</n-text>
          <n-button
            type="primary"
            strong
            secondary
            :loading="creating"
            :disabled="!loggedIn"
            @click="handleCreate"
          >
            <template #icon>
              <SvgIcon name="Add" />
            </template>
            创建一起听房间
          </n-button>
        </n-flex>
      </n-card>

      <n-card size="small">
        <template #header>
          <n-flex align="center" :size="8">
            <SvgIcon name="Person" :size="20" />
            <n-text strong>加入房间</n-text>
          </n-flex>
        </template>
        <n-flex vertical :size="12">
          <n-input v-model:value="joinForm.roomId" placeholder="房间号" clearable />
          <n-input v-model:value="joinForm.inviterId" placeholder="邀请者 ID" clearable />
          <n-input
            v-model:value="inviteLink"
            placeholder="也可直接粘贴邀请链接自动识别"
            clearable
            @update:value="handleInviteInput"
          />
          <n-button
            type="primary"
            strong
            secondary
            :loading="joining"
            :disabled="!loggedIn"
            @click="handleJoin"
          >
            <template #icon>
              <SvgIcon name="Link" />
            </template>
            加入一起听房间
          </n-button>
        </n-flex>
      </n-card>
    </template>

    <!-- 房间信息 -->
    <template v-else>
      <n-card size="small">
        <template #header>
          <n-flex align="center" justify="space-between">
            <n-flex align="center" :size="8">
              <SvgIcon name="Person" :size="20" />
              <n-text strong>房间 {{ listenTogetherStore.roomId }}</n-text>
            </n-flex>
            <n-tag size="small" :type="roomAvailable ? 'success' : 'default'">
              {{ listenTogetherStore.roomStatusText || "已连接" }}
            </n-tag>
          </n-flex>
        </template>
        <n-flex vertical :size="12">
          <n-flex align="center" justify="space-between">
            <n-text depth="3">邀请者 ID：{{ listenTogetherStore.inviterId }}</n-text>
            <n-button size="small" type="primary" strong secondary @click="handleCopyLink">
              <template #icon>
                <SvgIcon name="Copy" />
              </template>
              复制邀请链接
            </n-button>
          </n-flex>
          <n-divider class="divider" />
          <n-text depth="3">在线成员（{{ listenTogetherStore.memberCount }}）</n-text>
          <n-empty
            v-if="!listenTogetherStore.members.length"
            size="small"
            description="暂无在线成员"
          />
          <n-flex v-else :size="16" align="flex-start" class="member-list">
            <n-flex
              v-for="user in listenTogetherStore.members"
              :key="user.userId"
              align="center"
              :size="4"
              vertical
              class="member"
            >
              <n-avatar round :size="36" :src="user.avatarUrl || undefined">
                {{ (user.nickname || "听").slice(0, 1) }}
              </n-avatar>
              <n-text class="member-name" depth="2">
                {{ user.nickname || `用户 ${user.userId}` }}
              </n-text>
            </n-flex>
          </n-flex>
        </n-flex>
      </n-card>

      <!-- 房间播放状态 -->
      <n-card size="small">
        <template #header>
          <n-flex align="center" :size="8">
            <SvgIcon name="Music" :size="20" />
            <n-text strong>房间播放</n-text>
          </n-flex>
        </template>
        <n-flex vertical :size="12">
          <n-flex v-if="listenTogetherStore.currentTrack" align="center" :size="12">
            <n-avatar round :size="48" :src="currentCover || undefined" />
            <n-flex vertical :size="2" class="track-info">
              <n-text strong class="track-name">{{ listenTogetherStore.currentTrack.name }}</n-text>
              <n-text depth="3" class="track-artist">{{ trackArtists }}</n-text>
            </n-flex>
          </n-flex>
          <n-text v-else depth="3">暂无同步曲目</n-text>
          <n-flex align="center" :size="12">
            <n-tag
              size="small"
              :type="listenTogetherStore.remotePlayStatus === 'PLAY' ? 'success' : 'default'"
            >
              {{ listenTogetherStore.remotePlayStatus === "PLAY" ? "播放中" : "已暂停" }}
            </n-tag>
            <n-text depth="3">{{ msToTime(listenTogetherStore.remoteProgress) }}</n-text>
            <n-text v-if="listenTogetherStore.lastSyncTime" depth="3">
              上次同步 {{ lastSyncText }}
            </n-text>
          </n-flex>
          <n-flex align="center" :size="8">
            <n-switch v-model:value="listenTogetherStore.followEnabled" size="small" />
            <n-text depth="2">跟随房间同步播放</n-text>
          </n-flex>
          <n-flex :size="8">
            <n-button size="small" secondary :loading="applying" @click="handleApply">
              立即同步
            </n-button>
            <n-button size="small" secondary @click="handlePushSong">推送当前歌曲</n-button>
            <n-button size="small" secondary :loading="syncing" @click="handlePushPlaylist">
              同步播放列表
            </n-button>
          </n-flex>
          <n-text depth="3" class="tip">
            房间播放信息由服务端返回，若对方未回传状态，可使用「立即同步」手动拉取。
          </n-text>
        </n-flex>
      </n-card>

      <n-flex justify="end" :size="8">
        <n-button
          v-if="listenTogetherStore.isCreator"
          size="small"
          type="error"
          secondary
          @click="handleLeave(true)"
        >
          关闭房间
        </n-button>
        <n-button v-else size="small" secondary @click="handleLeave(false)">退出房间</n-button>
      </n-flex>
    </template>
  </n-flex>
</template>

<script setup lang="ts">
import { useListenTogetherStore } from "@/stores";
import { isLogin } from "@/utils/auth";
import { copyData } from "@/utils/helper";
import { msToTime } from "@/utils/time";

const listenTogetherStore = useListenTogetherStore();

const creating = ref(false);
const joining = ref(false);
const applying = ref(false);
const syncing = ref(false);
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

// 解析邀请链接
const handleInviteInput = (value: string) => {
  if (!value || !value.includes("roomId=")) return;
  const link = value.trim();
  const roomId = link.match(/[?&]roomId=([^&]+)/)?.[1];
  const inviterId = link.match(/[?&]inviterId=([^&]+)/)?.[1];
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

// 同步播放列表
const handlePushPlaylist = async () => {
  syncing.value = true;
  try {
    const count = await listenTogetherStore.syncPlaylistToRoom();
    if (count > 0) window.$message.success(`已同步 ${count} 首歌曲`);
  } finally {
    syncing.value = false;
  }
};

// 离开房间
const handleLeave = async (close: boolean) => {
  await listenTogetherStore.leaveRoom(close);
};
</script>

<style scoped lang="scss">
.listen-together {
  width: 100%;

  .divider {
    margin: 4px 0;
  }

  .member-list {
    flex-wrap: wrap;
  }

  .member {
    max-width: 72px;
  }

  .member-name {
    width: 100%;
    overflow: hidden;
    font-size: 12px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-info {
    overflow: hidden;
  }

  .track-name,
  .track-artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tip {
    font-size: 12px;
  }
}
</style>
