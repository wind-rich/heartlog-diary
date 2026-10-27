/** 作者题库的离线起步模板。只提供问题与候选，正确答案必须由作者自己选。 */
export interface QuizTemplate {
  id: string
  category: string
  prompt: string
  options: string[]
}

export const QUIZ_TEMPLATE_CATEGORIES = ['初次与日常', '偏好', '习惯', '共同回忆', '未来'] as const

export const QUIZ_TEMPLATES: QuizTemplate[] = [
  { id: 't01', category: '初次与日常', prompt: '第一次见面时，他给我的第一印象更接近哪一种？', options: ['安静慢热', '开朗健谈', '有点紧张'] },
  { id: 't02', category: '初次与日常', prompt: '我们第一次一起吃饭，吃的是什么？', options: ['正餐', '小吃', '甜品和饮料'] },
  { id: 't03', category: '初次与日常', prompt: '他第一次主动约我时，用了什么理由？', options: ['吃饭', '散步', '看电影'] },
  { id: 't04', category: '初次与日常', prompt: '我们第一次一起看的电影，更接近哪一类？', options: ['喜剧', '爱情', '悬疑或科幻'] },
  { id: 't05', category: '初次与日常', prompt: '他更习惯用哪种方式说“我想你”？', options: ['直接说', '发一张照片', '默默来找我'] },
  { id: 't06', category: '初次与日常', prompt: '我们通常谁先提出“今天吃什么”？', options: ['我', '他', '看当天心情'] },
  { id: 't07', category: '偏好', prompt: '他更喜欢哪种天气？', options: ['晴天', '雨天', '阴天'] },
  { id: 't08', category: '偏好', prompt: '他的“续命水”更接近哪一种？', options: ['咖啡', '茶', '甜饮'] },
  { id: 't09', category: '偏好', prompt: '他挑餐厅时最看重什么？', options: ['味道', '环境', '离得近'] },
  { id: 't10', category: '偏好', prompt: '他更容易接受哪种惊喜？', options: ['小礼物', '一起去某个地方', '一顿认真准备的饭'] },
  { id: 't11', category: '偏好', prompt: '他更喜欢的休息方式是什么？', options: ['宅在家', '出门走走', '睡一整天'] },
  { id: 't12', category: '偏好', prompt: '他更喜欢吃哪一类甜点？', options: ['奶油蛋糕', '面包', '水果类'] },
  { id: 't13', category: '习惯', prompt: '他出门前最容易忘记带什么？', options: ['钥匙', '充电线', '纸巾'] },
  { id: 't14', category: '习惯', prompt: '他压力大时更常见的表现是什么？', options: ['话变少', '想一个人待着', '想找人陪着'] },
  { id: 't15', category: '习惯', prompt: '他更习惯把东西放在哪里？', options: ['固定位置', '随手放', '看当天用什么包'] },
  { id: 't16', category: '习惯', prompt: '他睡前更常做什么？', options: ['刷手机', '聊天', '看书或听东西'] },
  { id: 't17', category: '习惯', prompt: '他更愿意哪种方式被安慰？', options: ['先听我说完', '讲点好笑的', '安静陪着'] },
  { id: 't18', category: '习惯', prompt: '他更常把情绪藏起来，还是写在脸上？', options: ['藏起来', '写在脸上', '看事情大小'] },
  { id: 't19', category: '共同回忆', prompt: '我们哪一次出门，他后来提得最多？', options: ['一次短途旅行', '一次普通散步', '一次临时起意'] },
  { id: 't20', category: '共同回忆', prompt: '他最喜欢我拍过他的哪一类照片？', options: ['认真做事时', '笑的时候', '没看镜头的时候'] },
  { id: 't21', category: '共同回忆', prompt: '我们最有默契的一件小事是什么？', options: ['点菜', '走路节奏', '一个眼神就懂'] },
  { id: 't22', category: '共同回忆', prompt: '他第一次在我面前放松下来，是在什么场景？', options: ['吃饭时', '散步时', '在车里或路上'] },
  { id: 't23', category: '未来', prompt: '他更想先实现哪一件小事？', options: ['一起去旅行', '养一只小动物', '把家布置得更舒服'] },
  { id: 't24', category: '未来', prompt: '他希望我们的周末更像哪一种？', options: ['有计划地出门', '在家慢慢过', '临时决定'] },
]
