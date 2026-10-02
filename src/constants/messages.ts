import { ExchangeStatus } from './exchange';
import { ItemStatus } from './item';

export const PAGE_MESSAGES = {
  homeEmpty: '暂时没有符合条件的闲置物品',
  publishReady: '发布后会同步写入 localStorage 和 IndexedDB',
  exchangeEmpty: '还没有交换请求，先去首页挑一件合眼缘的物品',
  profileUpdated: '个人资料已更新',
  staleSubmitTitle: '这个页面的内容已经落后',
  staleSubmitHint: '你填写的内容已保留，请确认下面的最新改动后基于新数据重试。',
  pendingBatchTitle: '有未完成的提交',
  pendingBatchHint: '上次提交在写入过程中中断，交换与物品还没有一起成功。',
};

export const FORM_MESSAGES = {
  requiredTitle: '物品标题不能为空',
  requiredDescription: '请描述你希望交换的物品',
  requiredPhone: '请填写联系方式',
  imageLimit: '最多上传 4 张图片',
  exchangeNeedOwnItem: '请先发布一件可交换物品',
};

export const LOG_MESSAGES = {
  storageHydrated: 'storage hydrated with status maps',
  storageMigrated: 'storage migrated to revision-enabled version',
  itemStatusUsed: `ItemStatus includes ${ItemStatus.AVAILABLE}, ${ItemStatus.BOOKED}, ${ItemStatus.EXCHANGED}, ${ItemStatus.OFFLINE}`,
  exchangeStatusUsed: `ExchangeStatus includes ${ExchangeStatus.PENDING}, ${ExchangeStatus.ACCEPTED}, ${ExchangeStatus.REJECTED}, ${ExchangeStatus.COMPLETED}`,
};

export const STATUS_MESSAGE_MAP = {
  [ItemStatus.AVAILABLE]: '这件物品可发起交换',
  [ItemStatus.BOOKED]: '交换已同意，物品锁定中',
  [ItemStatus.EXCHANGED]: '这件物品已完成交换',
  [ItemStatus.OFFLINE]: '这件物品已下架',
  [ExchangeStatus.PENDING]: '等待对方确认',
  [ExchangeStatus.ACCEPTED]: '交换已同意，可确认完成',
  [ExchangeStatus.REJECTED]: '交换请求已拒绝',
  [ExchangeStatus.COMPLETED]: '交换流程已完成',
};
