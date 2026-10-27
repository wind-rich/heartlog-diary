import { placeholderImage } from './media'
import type {
  PublicAnniversary,
  PublicDailyStatus,
  PublicEntry,
  PublicGameContent,
  PublicGift,
  PublicHealth,
  PublicInsight,
  PublicPerson,
  PublicPreference,
  PublicPhoto,
  PublicSummary,
  PublicWish,
  PublishedSnapshot,
  SnapshotScene,
} from '../types'
import { VIEWER_FORMAT_VERSION } from '../types'

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const DAY = 86400000
const NOW = new Date()

function iso(daysAgo: number, hour = 20, minute = 15): string {
  const d = new Date(NOW.getTime() - daysAgo * DAY)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function dateOnly(daysAgo: number): string {
  const d = new Date(NOW.getTime() - daysAgo * DAY)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const MEDIA_MIME = 'image/svg+xml'

function media(key: string, url: string) {
  return { key, url, mime: MEDIA_MIME, size: url.length, hash: `h_${key}` }
}

interface PhotoSpec {
  id: string
  caption: string
  daysAgo: number
  ratio?: '4:5' | '1:1' | '3:2'
  entryId?: string
  giftId?: string
  tags?: string[]
}

function makePhoto(spec: PhotoSpec): PublicPhoto {
  const [w, h] =
    spec.ratio === '1:1' ? [900, 900] : spec.ratio === '3:2' ? [900, 600] : [900, 1125]
  return {
    id: spec.id,
    personId: 'p_demo',
    mime: MEDIA_MIME,
    size: 0,
    width: w,
    height: h,
    takenAt: iso(spec.daysAgo, 15, 40),
    caption: spec.caption,
    tags: spec.tags ?? [],
    entryId: spec.entryId,
    giftId: spec.giftId,
    media: {
      thumb: media(`${spec.id}/thumb`, placeholderImage(`${spec.id}/thumb`, { width: 360, height: Math.round((360 * h) / w), simple: true })),
      full: media(`${spec.id}/full`, placeholderImage(`${spec.id}/full`, { width: w, height: h })),
    },
  }
}

/* ------------------------------------------------------------------ */
/* 默认演示数据                                                        */
/* ------------------------------------------------------------------ */

const PHOTO_SPECS: PhotoSpec[] = [
  { id: 'ph_01', caption: '傍晚的江边，风把云吹成一层层', daysAgo: 4, entryId: 'e_01', tags: ['傍晚'] },
  { id: 'ph_02', caption: '他挑的那束花，说颜色像我', daysAgo: 12, entryId: 'e_02', tags: ['花'] },
  { id: 'ph_03', caption: '一起走过的旧街', daysAgo: 26, entryId: 'e_04' },
  { id: 'ph_04', caption: '他做的第一顿番茄牛腩', daysAgo: 38, entryId: 'e_05', tags: ['在家'] },
  { id: 'ph_05', caption: '凌晨的便利店', daysAgo: 51, ratio: '1:1', entryId: 'e_06' },
  { id: 'ph_06', caption: '海边的第三天', daysAgo: 74, ratio: '3:2', entryId: 'e_08', tags: ['旅行'] },
  { id: 'ph_07', caption: '他把伞都偏向这边', daysAgo: 96, entryId: 'e_09' },
  { id: 'ph_08', caption: '生日的蛋糕，歪了一点', daysAgo: 38, ratio: '1:1', entryId: 'e_10', tags: ['生日'] },
  { id: 'ph_09', caption: '阳台上晒着的两件外套', daysAgo: 118, entryId: 'e_11' },
  { id: 'ph_10', caption: '他说这张拍得像电影', daysAgo: 143, ratio: '3:2', entryId: 'e_12' },
  { id: 'ph_11', caption: '周末的面包店', daysAgo: 165, entryId: 'e_13', tags: ['吃'] },
  { id: 'ph_12', caption: '深夜的便利店关东煮', daysAgo: 190, entryId: 'e_14' },
  { id: 'ph_13', caption: '一起看完的第七部电影', daysAgo: 214, ratio: '1:1', entryId: 'e_15' },
  { id: 'ph_14', caption: '冬天第一场雪落在肩上', daysAgo: 246, entryId: 'e_16', tags: ['冬天'] },
  { id: 'ph_15', caption: '他睡着的样子', daysAgo: 271, entryId: 'e_17' },
  { id: 'ph_16', caption: '纪念日那天的餐桌', daysAgo: 302, ratio: '3:2', entryId: 'e_18', tags: ['纪念日'] },
]

const ANNIVERSARIES: PublicAnniversary[] = [
  { id: 'an_01', name: '相识纪念日', date: '2022-03-06', calendarType: 'solar', repeatYearly: true, note: '第一次说话的那天' },
  { id: 'an_02', name: '他的生日', date: '1996-09-17', calendarType: 'solar', repeatYearly: true },
  { id: 'an_03', name: '第一次一起看海', date: '2023-07-21', calendarType: 'solar', repeatYearly: true },
]

const ENTRIES: PublicEntry[] = [
  {
    id: 'e_01',
    occurredAt: iso(4, 19, 20),
    kind: 'daily',
    title: '江边散步，他说想在这里养老',
    content:
      '下班后临时决定去江边走走。风有点凉，他把外套脱下来搭在我肩上。走到桥下的时候他忽然说，老了以后想住在这附近，每天都能这样走一圈。',
    taSaid: '等我们老了，就住这旁边吧，每天走一遍。',
    myObservation: '他很少主动说以后的事，这次说得特别轻，但很认真。',
    mood: 'calm',
    moodLevel: 5,
    tags: ['散步', '以后'],
    photoIds: ['ph_01'],
    quick: false,
  },
  {
    id: 'e_02',
    occurredAt: iso(12, 18, 5),
    kind: 'date',
    title: '他挑的那束花',
    content: '说是路过花店，其实那家店在不顺路的方向。他挑了橙色的，说这个颜色像我。',
    taSaid: '这个颜色像你，看着就暖。',
    mood: 'happy',
    moodLevel: 5,
    tags: ['花', '小心思'],
    photoIds: ['ph_02'],
    quick: false,
  },
  {
    id: 'e_03',
    occurredAt: iso(19, 22, 40),
    kind: 'emotion',
    title: '加班到很晚，他没说什么',
    content: '回家已经快十一点。他没有问为什么这么晚，只是把汤热了一下放在桌上。',
    myObservation: '比起追问，他更习惯用做事来表达担心。',
    mood: 'low',
    moodLevel: 2,
    tags: ['加班'],
    photoIds: [],
    quick: true,
  },
  {
    id: 'e_04',
    occurredAt: iso(26, 16, 10),
    kind: 'date',
    title: '重走了一遍初次见面的旧街',
    content: '那条街改造过了，原来那家咖啡馆还在。他记得我们坐的是靠窗第二张桌子。',
    taSaid: '你那天点了热的，喝一口就皱眉。',
    myObservation: '他记细节的能力比我强得多，尤其关于我的。',
    mood: 'happy',
    moodLevel: 4,
    tags: ['旧地重游'],
    photoIds: ['ph_03'],
    quick: false,
  },
  {
    id: 'e_05',
    occurredAt: iso(38, 19, 30),
    kind: 'daily',
    title: '他做的番茄牛腩',
    content: '第一次做，盐放多了。他还是坚持说自己做得不错，让我多吃了半碗饭。',
    taSaid: '下次少放点盐，你别吃那么咸。',
    mood: 'happy',
    moodLevel: 4,
    tags: ['在家', '做饭'],
    photoIds: ['ph_04'],
    quick: false,
  },
  {
    id: 'e_06',
    occurredAt: iso(51, 0, 35),
    kind: 'daily',
    title: '凌晨十二点的便利店',
    content: '睡不着，两个人穿着拖鞋下楼。他说关东煮的萝卜要最后吃才好吃。',
    taSaid: '萝卜要泡到最后，味道才进去。',
    mood: 'calm',
    moodLevel: 4,
    tags: ['深夜'],
    photoIds: ['ph_05'],
    quick: true,
  },
  {
    id: 'e_07',
    occurredAt: iso(63, 21, 15),
    kind: 'health',
    title: '换季又开始咳嗽',
    content: '每年这个时候都会咳一阵。这次提前买了药，没有再拖到发烧。',
    myObservation: '他对自己的身体不太上心，需要有人盯着。',
    mood: 'anxious',
    moodLevel: 3,
    tags: ['换季', '咳嗽'],
    photoIds: [],
    quick: false,
  },
  {
    id: 'e_08',
    occurredAt: iso(74, 17, 50),
    kind: 'date',
    title: '海边第三天，什么都没做',
    content: '住的地方离海很近，每天就是走走，坐着，看天色变。他说这样浪费时间很好。',
    taSaid: '这样浪费时间，才是休息。',
    mood: 'calm',
    moodLevel: 5,
    tags: ['旅行', '海'],
    photoIds: ['ph_06'],
    quick: false,
  },
  {
    id: 'e_09',
    occurredAt: iso(96, 8, 20),
    kind: 'daily',
    title: '下雨，他把伞都偏向这边',
    content: '到公司时他整个右肩都湿了，还说没事，走快点就到了。',
    myObservation: '他总把这些当成理所当然，不太愿意被感谢。',
    mood: 'calm',
    moodLevel: 4,
    tags: ['下雨'],
    photoIds: ['ph_07'],
    quick: false,
  },
  {
    id: 'e_10',
    occurredAt: iso(38, 21, 0),
    kind: 'date',
    title: '给他过生日',
    content: '蛋糕是他自己挑的，说不要太大的。蜡烛点上之后他愣了几秒才许愿，说已经很久没过生日了。',
    taSaid: '好久没人给我过生日了。',
    mood: 'happy',
    moodLevel: 5,
    tags: ['生日'],
    photoIds: ['ph_08'],
    quick: false,
  },
  {
    id: 'e_11',
    occurredAt: iso(118, 10, 30),
    kind: 'daily',
    title: '阳台上的两件外套',
    content: '洗完晾在一起，风一吹会碰到。莫名觉得这个画面很好。',
    mood: 'calm',
    moodLevel: 4,
    tags: ['日常'],
    photoIds: ['ph_09'],
    quick: true,
  },
  {
    id: 'e_12',
    occurredAt: iso(143, 15, 20),
    kind: 'interest',
    title: '他喜欢的那类电影',
    content: '节奏很慢、对白很少的那种。他说不用一直有事情发生，看着人待着就行。',
    myObservation: '这条已经被三次记录印证，不是偶然偏好。',
    mood: 'calm',
    moodLevel: 3,
    tags: ['电影'],
    photoIds: ['ph_10'],
    quick: false,
  },
  {
    id: 'e_13',
    occurredAt: iso(165, 11, 0),
    kind: 'daily',
    title: '周末去买面包',
    content: '他站在面包店门口等了二十分钟，就为了刚出炉的那一炉。',
    taSaid: '刚出来的和放凉的不是一个东西。',
    mood: 'happy',
    moodLevel: 4,
    tags: ['吃', '周末'],
    photoIds: ['ph_11'],
    quick: true,
  },
  {
    id: 'e_14',
    occurredAt: iso(190, 23, 45),
    kind: 'daily',
    title: '加班回家，他在楼下等我',
    content: '说是刚好下来扔垃圾。垃圾袋是空的。',
    myObservation: '他不太会说"我在担心你"，但会站在楼下。',
    mood: 'calm',
    moodLevel: 5,
    tags: ['深夜', '加班'],
    photoIds: ['ph_12'],
    quick: false,
  },
  {
    id: 'e_15',
    occurredAt: iso(214, 20, 0),
    kind: 'date',
    title: '一起看完的第七部电影',
    content: '片尾字幕走完之后他才起身，说这个结尾比想象中好。',
    mood: 'calm',
    moodLevel: 4,
    tags: ['电影'],
    photoIds: ['ph_13'],
    quick: false,
  },
  {
    id: 'e_16',
    occurredAt: iso(246, 9, 10),
    kind: 'daily',
    title: '今年第一场雪',
    content: '他站在窗边看了很久，说南方的雪下不大，但每年都想看。',
    taSaid: '每年都想看一次，哪怕就一点。',
    mood: 'calm',
    moodLevel: 4,
    tags: ['冬天', '雪'],
    photoIds: ['ph_14'],
    quick: true,
  },
  {
    id: 'e_17',
    occurredAt: iso(271, 14, 0),
    kind: 'daily',
    title: '午睡睡过了头',
    content: '本来只说躺十分钟，结果睡了一个半小时。醒来第一句话是问我饿不饿。',
    mood: 'calm',
    moodLevel: 3,
    tags: ['日常'],
    photoIds: ['ph_15'],
    quick: true,
  },
  {
    id: 'e_18',
    occurredAt: iso(302, 19, 40),
    kind: 'date',
    title: '相识纪念日，还是那家店',
    content: '提前一周订的位。他说本来想给我惊喜，但实在藏不住。',
    taSaid: '本来想瞒着你的，但一说谎你就能看出来。',
    mood: 'happy',
    moodLevel: 5,
    tags: ['纪念日'],
    photoIds: ['ph_16'],
    quick: false,
  },
]

const PREFERENCES: PublicPreference[] = [
  {
    id: 'pr_01',
    category: '食物',
    name: '关东煮里的萝卜',
    direction: 'like',
    likeLevel: 5,
    note: '要泡到最后再吃',
    tags: ['吃'],
    lastConfirmedAt: dateOnly(51),
    evidenceEntryIds: ['e_06'],
  },
  {
    id: 'pr_02',
    category: '食物',
    name: '香菜',
    direction: 'dislike',
    likeLevel: 4,
    note: '会挑出来放在一边，不会说',
    tags: ['吃'],
    lastConfirmedAt: dateOnly(38),
    evidenceEntryIds: ['e_05'],
  },
  {
    id: 'pr_03',
    category: '电影',
    name: '节奏慢、对白少的片子',
    direction: 'like',
    likeLevel: 4,
    note: '看过三次以上，已经不是偶然',
    tags: ['电影'],
    lastConfirmedAt: dateOnly(143),
    evidenceEntryIds: ['e_12', 'e_15'],
  },
  {
    id: 'pr_04',
    category: '习惯',
    name: '睡不着会下楼走一圈',
    direction: 'like',
    likeLevel: 3,
    tags: ['深夜'],
    lastConfirmedAt: dateOnly(51),
    evidenceEntryIds: ['e_06'],
  },
  {
    id: 'pr_05',
    category: '音乐',
    name: '路上会放很轻的纯音乐',
    direction: 'like',
    likeLevel: 3,
    tags: ['音乐'],
    evidenceEntryIds: [],
  },
  {
    id: 'pr_06',
    category: '运动',
    name: '羽毛球',
    direction: 'want',
    note: '提过两次想重新打',
    tags: ['运动'],
    evidenceEntryIds: ['e_12'],
  },
]

const WISHES: PublicWish[] = [
  { id: 'w_01', content: '想去看一次真的雪，不只是窗边那种', raisedAt: dateOnly(246), status: 'wish', priority: 1, occasion: '随口说的', note: '可以先从北方的城市安排', entryIds: ['e_16'] },
  { id: 'w_02', content: '想要一个能用很多年的保温杯', raisedAt: dateOnly(120), status: 'gifted', priority: 2, giftId: 'g_01', entryIds: [] },
  { id: 'w_03', content: '重新开始打羽毛球', raisedAt: dateOnly(160), status: 'wish', priority: 2, entryIds: ['e_12'] },
  { id: 'w_04', content: '把阳台收拾出来，种点东西', raisedAt: dateOnly(118), status: 'paused', priority: 3, note: '等天气暖一点', entryIds: ['e_11'] },
  { id: 'w_05', content: '一起吃一次他做失败的番茄牛腩', raisedAt: dateOnly(38), status: 'fulfilled', priority: 3, entryIds: ['e_05'] },
]

const GIFTS: PublicGift[] = [
  { id: 'g_01', name: '保温杯', givenAt: dateOnly(110), occasion: '没有特别的理由', feedback: '第二天就带去公司了，说保温效果好', photoIds: [], wishId: 'w_02' },
  { id: 'g_02', name: '那双他试了两次没买的鞋', givenAt: dateOnly(180), occasion: '生日', feedback: '说太贵了，但一直在穿', photoIds: [], entryId: 'e_10' },
  { id: 'g_03', name: '一本摄影集', givenAt: dateOnly(230), occasion: '纪念日', feedback: '翻了很多次，摆在客厅', photoIds: [], entryId: 'e_18' },
  { id: 'g_04', name: '手写的信', givenAt: dateOnly(302), occasion: '相识纪念日', feedback: '看完没说话，收进抽屉了', photoIds: [], entryId: 'e_18' },
]

const HEALTH: PublicHealth[] = [
  { id: 'h_01', occurredAt: iso(63, 21, 0), symptom: '换季咳嗽', severity: 2, note: '提前买了药，没有拖到发烧', status: 'recovered', recovery: '一周左右好转', resolvedAt: dateOnly(55) },
  { id: 'h_02', occurredAt: iso(150, 9, 0), symptom: '久坐腰酸', severity: 3, note: '提醒他起来走动，开始做拉伸', status: 'watching' },
  { id: 'h_03', occurredAt: iso(280, 22, 0), symptom: '熬夜后头痛', severity: 2, note: '睡一觉就好，之后尽量不再熬到两点', status: 'recovered', resolvedAt: dateOnly(278) },
]

const INSIGHTS: PublicInsight[] = [
  { id: 'i_01', dimension: '相处偏好', description: '不太需要被安慰，更需要有人在旁边待着', evidenceType: 'repeated', evidenceEntryIds: ['e_03', 'e_14'], confirmState: 'confirmed' },
  { id: 'i_02', dimension: '情绪与支持方式', description: '难过时先沉默，通常半天之后才会讲', evidenceType: 'repeated', evidenceEntryIds: ['e_03', 'e_09'], confirmState: 'confirmed' },
  { id: 'i_03', dimension: '在意的事情', description: '被记住细节会让他很开心，但不会主动说', evidenceType: 'stated', evidenceEntryIds: ['e_04', 'e_10'], confirmState: 'confirmed' },
  { id: 'i_04', dimension: '兴趣与动力', description: '喜欢节奏慢的内容，不需要密集的信息量', evidenceType: 'repeated', evidenceEntryIds: ['e_12', 'e_15'], confirmState: 'confirmed' },
  { id: 'i_05', dimension: '近期变化', description: '最近主动提起「以后」的次数变多了', evidenceType: 'hypothesis', evidenceEntryIds: ['e_01'], confirmState: 'pending' },
]

const SUMMARIES: PublicSummary[] = [
  {
    id: 's_01',
    kind: 'month',
    title: '这个月，他把以后说得更具体了',
    rangeStart: dateOnly(30),
    rangeEnd: dateOnly(0),
    generator: 'manual',
    content:
      '## 这个月\n\n这个月的记录不多，但有两件事值得留下。\n\n- 江边说想住在这附近，是他第一次主动提「老了以后」。\n- 加班那天没有追问，只是把汤热好。\n\n## 需要留意\n\n换季的咳嗽每年都来，今年提前买了药。',
    evidenceEntryIds: ['e_01', 'e_03'],
  },
  {
    id: 's_02',
    kind: 'portrait',
    title: '关于他的画像（节选）',
    rangeStart: dateOnly(365),
    rangeEnd: dateOnly(0),
    generator: 'ai',
    content:
      '## 确认过的部分\n\n他用做事表达在意，而不是用语言。这一点在多次记录里都出现过。\n\n## 仍在观察\n\n最近开始主动说以后的事，是否意味着状态变化，还需要更多记录。',
    evidenceEntryIds: ['e_01', 'e_03', 'e_14'],
  },
]

const STATUSES: PublicDailyStatus[] = [
  { id: 'd_01', date: dateOnly(0), mood: 'calm', moodLevel: 4, energy: 3, sleepHours: 7, goodThing: '晚上一起吃了面', note: '' },
  { id: 'd_02', date: dateOnly(1), mood: 'happy', moodLevel: 4, energy: 4, sleepHours: 7.5, goodThing: '他记得我说过的话' },
  { id: 'd_03', date: dateOnly(2), mood: 'calm', moodLevel: 3, energy: 3, sleepHours: 6.5 },
  { id: 'd_04', date: dateOnly(4), mood: 'calm', moodLevel: 5, energy: 3, sleepHours: 8, goodThing: '江边散步' },
  { id: 'd_05', date: dateOnly(6), mood: 'low', moodLevel: 2, energy: 2, sleepHours: 5.5, worry: '工作上的事没处理完' },
  { id: 'd_06', date: dateOnly(7), mood: 'calm', moodLevel: 3, energy: 3, sleepHours: 7 },
]

/* ------------------------------------------------------------------ */
/* 快照组装                                                            */
/* ------------------------------------------------------------------ */

function buildDemo(): PublishedSnapshot {
  const photos = PHOTO_SPECS.map(makePhoto)
  const person: PublicPerson = {
    id: 'p_demo',
    displayName: '他',
    nickname: '',
    intro: '这里保存的都是围绕你发生的小事：你说过的话、你喜欢的东西、我们一起过的日子。',
    avatarPhotoId: undefined,
    birthday: '1996-09-17',
    calendarType: 'solar',
    zodiac: '处女座',
    meetDate: '2022-03-06',
    tags: ['温柔', '慢热', '爱吃甜'],
  }

  const GAME_CONTENT: PublicGameContent[] = [
    {
      id: 'gq_01', kind: 'quiz', schemaVersion: 1, prompt: '他更容易被哪一种安慰打动？',
      options: [
        { id: 'a', text: '认真听完再抱一下' },
        { id: 'b', text: '立刻讲道理分析' },
        { id: 'c', text: '假装什么都没发生' },
      ],
      correctOptionId: 'a', explanation: '先接住情绪，再一起想办法。', sourceEntryIds: ['e_02'],
    },
    {
      id: 'gq_02', kind: 'quiz', schemaVersion: 1, prompt: '下面哪一种是他的“续命水”？',
      options: [
        { id: 'a', text: '冰美式' },
        { id: 'b', text: '热可可' },
        { id: 'c', text: '气泡水' },
        { id: 'd', text: '白开水' },
      ],
      correctOptionId: 'b', explanation: '天气冷的时候尤其明显。', sourceEntryIds: ['e_06'],
    },
    {
      id: 'gq_03', kind: 'quiz', schemaVersion: 1, prompt: '他拍照时最常说什么？',
      options: [
        { id: 'a', text: '这张像电影' },
        { id: 'b', text: '别动，光很好' },
        { id: 'c', text: '随便拍一张就行' },
      ],
      correctOptionId: 'b', sourceEntryIds: ['e_12'],
    },
    {
      id: 'gq_04', kind: 'quiz', schemaVersion: 1, prompt: '他做饭的拿手菜是哪一道？',
      options: [
        { id: 'a', text: '番茄牛腩' },
        { id: 'b', text: '清蒸鱼' },
        { id: 'c', text: '咖喱饭' },
      ],
      correctOptionId: 'a', explanation: '第一次做就已经很像样。', sourceEntryIds: ['e_05'],
    },
    {
      id: 'gq_05', kind: 'quiz', schemaVersion: 1, prompt: '下雪天他最容易先做什么？',
      options: [
        { id: 'a', text: '催我多穿一点' },
        { id: 'b', text: '先发朋友圈' },
        { id: 'c', text: '立刻出门跑步' },
      ],
      correctOptionId: 'a', sourceEntryIds: ['e_16'],
    },
    { id: 'gd_01', kind: 'dateCard', schemaVersion: 1, category: 'activity', text: '一起复刻第一次约会点过的东西', tags: ['setting:indoor', 'budget:low', 'duration:short'] },
    { id: 'gd_02', kind: 'dateCard', schemaVersion: 1, category: 'place', text: '找一家安静的甜品店', tags: ['setting:indoor', 'budget:low', 'duration:short'] },
    { id: 'gd_03', kind: 'dateCard', schemaVersion: 1, category: 'surprise', text: '各自写下一句今天的感谢，交换着读', tags: ['setting:any', 'budget:free', 'duration:short'] },
  ]

  return {
    manifest: {
      formatVersion: VIEWER_FORMAT_VERSION,
      siteId: 'site_demo',
      publishId: 'pub_20261025_demo',
      basePublishId: 'pub_20261018_demo',
      publishedAt: iso(0, 9, 12),
      counts: {
        entries: ENTRIES.length,
        photos: photos.length,
        preferences: PREFERENCES.length,
        wishes: WISHES.length,
        gifts: GIFTS.length,
        health: HEALTH.length,
        insights: INSIGHTS.length,
        summaries: SUMMARIES.length,
        anniversaries: ANNIVERSARIES.length,
        gameContent: GAME_CONTENT.length,
      },
      contentHash: 'sha256:demo0000000000',
    },
    config: {
      centerPersonId: 'p_demo',
      tagline: '整个宇宙，都是关于你的记录',
      theme: 'warm-light',
      sections: { photos: true, stories: true, archive: true, wishes: true, health: true, music: true, game: true },
      games: {
        memory: { enabled: true },
        puzzle: { enabled: true },
        photoGuess: { enabled: true },
        memoryBox: { enabled: true },
        timeline: { enabled: true },
        quiz: { enabled: true },
        dateDraw: { enabled: true },
      },
      music: { title: '第 7 部电影的片尾曲', artist: '示例曲目', src: undefined },
    },
    person,
    anniversaries: ANNIVERSARIES,
    entries: ENTRIES,
    photos,
    preferences: PREFERENCES,
    wishes: WISHES,
    gifts: GIFTS,
    health: HEALTH,
    insights: INSIGHTS,
    summaries: SUMMARIES,
    statuses: STATUSES,
    gameContent: GAME_CONTENT,
  }
}

function buildEmpty(): PublishedSnapshot {
  const base = buildDemo()
  const person: PublicPerson = {
    ...base.person,
    displayName: '他的宇宙',
    intro: '',
    avatarPhotoId: undefined,
    tags: [],
    meetDate: undefined,
    birthday: undefined,
    zodiac: undefined,
  }
  return {
    ...base,
    manifest: { ...base.manifest, publishId: 'pub_20261025_empty', counts: {} },
    person,
    anniversaries: [],
    entries: [],
    photos: [],
    preferences: [],
    wishes: [],
    gifts: [],
    health: [],
    insights: [],
    summaries: [],
    statuses: [],
    gameContent: [],
  }
}

/** 图片失败场景：只用于验证失败占位与重试，不在演示入口暴露 */
function buildBroken(): PublishedSnapshot {
  const base = buildDemo()
  const photos = base.photos.map((p, i) =>
    i === 0 || i === 1
      ? {
          ...p,
          media: {
            ...p.media,
            thumb: { ...p.media.thumb, url: 'data:image/png;base64,AAAA' },
            full: { ...p.media.full, url: 'data:image/png;base64,AAAA' },
          },
        }
      : p,
  )
  return { ...base, photos }
}

/** 长文本场景：验证长称呼、长寄语及文字放大时的版式降级 */
function buildLong(): PublishedSnapshot {
  const base = buildDemo()
  return {
    ...base,
    person: {
      ...base.person,
      displayName: '我心里那个名字很长很长的人',
      intro: '这里保存的是一段用于检查长文本排版、自然换行和文字放大的介绍。即使内容很多，也不能遮住周围的入口。',
    },
    config: { ...base.config, tagline: '想把你认真说过的每一句话，都放进这个温柔的宇宙里' },
  }
}

/** 压力数据：验证分页与分批加载；数量不代表真实数据规模 */
function buildStress(): PublishedSnapshot {
  const base = buildDemo()
  const entries: PublicEntry[] = []
  const photos: PublicPhoto[] = []

  for (let i = 0; i < 1100; i++) {
    const daysAgo = Math.floor((i * 640) / 1100) + 1
    entries.push({
      id: `se_${String(i).padStart(4, '0')}`,
      occurredAt: iso(daysAgo, 8 + (i % 12), (i * 7) % 60),
      kind: (['daily', 'date', 'interest', 'emotion', 'health', 'other'] as const)[i % 6],
      title: `压力测试记录 #${i + 1}${i % 37 === 0 ? ' · 这是一条用于测试换行的超长标题，看看在窄屏上会不会把布局撑破' : ''}`,
      content: i % 3 === 0 ? '这是一段用于分页与加载测试的正文。内容本身没有含义，只用来确认列表在大量记录下的表现。' : undefined,
      taSaid: i % 5 === 0 ? '这是一句用于测试的引用。' : undefined,
      myObservation: i % 7 === 0 ? '这是一段用于测试的个人观察。' : undefined,
      mood: (['happy', 'calm', 'low', 'anxious'] as const)[i % 4],
      moodLevel: (i % 5) + 1,
      tags: i % 4 === 0 ? ['测试', '长列表'] : ['测试'],
      photoIds: i < 400 ? [`sp_${String(i).padStart(3, '0')}`] : [],
      quick: i % 2 === 0,
    })
  }

  for (let i = 0; i < 500; i++) {
    const id = `sp_${String(i).padStart(3, '0')}`
    const thumb = placeholderImage(`${id}/thumb`, { width: 200, height: 250, simple: true })
    photos.push({
      id,
      personId: 'p_demo',
      mime: MEDIA_MIME,
      size: 0,
      width: 900,
      height: 1125,
      takenAt: iso(Math.floor((i * 640) / 500) + 2, 12, 0),
      caption: `压力测试照片 #${i + 1}`,
      tags: ['测试'],
      entryId: i < 400 ? `se_${String(i).padStart(4, '0')}` : undefined,
      media: {
        thumb: media(`${id}/thumb`, thumb),
        full: media(`${id}/full`, thumb),
      },
    })
  }

  return {
    ...base,
    manifest: { ...base.manifest, publishId: 'pub_20261025_stress' },
    entries,
    photos,
  }
}

const CACHE = new Map<SnapshotScene, PublishedSnapshot>()

export function getSnapshot(scene: SnapshotScene): PublishedSnapshot {
  const hit = CACHE.get(scene)
  if (hit) return hit
  const built =
    scene === 'empty'
      ? buildEmpty()
      : scene === 'stress'
        ? buildStress()
        : scene === 'broken'
          ? buildBroken()
          : scene === 'long'
            ? buildLong()
            : buildDemo()
  CACHE.set(scene, built)
  return built
}

/**
 * 作者端发布预览使用的草稿快照。
 * 与线上版本共用同一套渲染路径，差异只体现在内容本身。
 */
export function getDraftSnapshot(scene: SnapshotScene): PublishedSnapshot {
  const base = getSnapshot(scene)
  const todayIso = iso(0, 8, 40)
  const draftEntry: PublicEntry = {
    id: 'e_draft_01',
    occurredAt: todayIso,
    kind: 'daily',
    title: '（草稿）今天早上他先起床煮了粥',
    content: '还没写完的一条草稿，用来确认预览里看到的就是待发布的内容。',
    taSaid: '你不用起来，我弄好了叫你。',
    mood: 'calm',
    moodLevel: 4,
    tags: ['草稿'],
    photoIds: ['ph_draft_01'],
    quick: true,
  }
  const draftPhoto = makePhoto({
    id: 'ph_draft_01',
    caption: '（草稿）今天早上的粥',
    daysAgo: 0,
    ratio: '4:5',
    entryId: 'e_draft_01',
  })

  const entries = [draftEntry, ...base.entries]
  const photos = [draftPhoto, ...base.photos]

  return {
    ...base,
    manifest: {
      ...base.manifest,
      publishId: 'draft-local',
      basePublishId: base.manifest.publishId,
      publishedAt: '',
      counts: { ...base.manifest.counts, entries: entries.length, photos: photos.length },
    },
    entries,
    photos,
    draft: {
      basedOn: base.manifest.publishId,
      addedEntries: 1,
      addedPhotos: 1,
      note: '本地草稿，尚未发布；预览不会改变线上版本',
    },
  }
}

export const DEMO_SCENES: { key: SnapshotScene; label: string; hint: string }[] = [
  { key: 'demo', label: '默认演示', hint: '16 张照片 / 18 条记录' },
  { key: 'empty', label: '空态', hint: '无照片、无头像、无记录' },
  { key: 'stress', label: '压力数据', hint: '1,100 条记录 / 500 张照片' },
]
