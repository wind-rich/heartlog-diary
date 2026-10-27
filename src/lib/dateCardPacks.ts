/** 作者端「一键添加」的推荐卡包。添加后仍是普通自定义卡，可自由编辑/停用。 */
export interface DateCardPack {
  id: string
  title: string
  description: string
  cards: { category: 'activity' | 'place' | 'surprise'; text: string; tags: string[] }[]
}

export const DATE_CARD_PACKS: DateCardPack[] = [
  {
    id: 'old-places',
    title: '我们的老地方',
    description: '把两个人去过的地方，变成下一次可以重走的小路线。',
    cards: [
      { category: 'activity', text: '重走第一次见面的路线', tags: ['setting:outdoor', 'budget:free', 'duration:half'] },
      { category: 'activity', text: '翻出旧照片，按图去找同一个角度', tags: ['setting:outdoor', 'budget:free', 'duration:half'] },
      { category: 'place', text: '第一次一起吃饭的那家店', tags: ['setting:indoor', 'budget:low', 'duration:short'] },
      { category: 'place', text: '以前常去散步的那条路', tags: ['setting:outdoor', 'budget:free', 'duration:short'] },
      { category: 'surprise', text: '各说一件第一次见面时记住的小事', tags: ['setting:any', 'budget:free', 'duration:short'] },
      { category: 'surprise', text: '给对方拍一张和旧照片同姿势的新照片', tags: ['setting:any', 'budget:free', 'duration:short'] },
    ],
  },
  {
    id: 'low-budget',
    title: '不花什么钱',
    description: '适合临时起意、预算很低，但仍然认真一起过。',
    cards: [
      { category: 'activity', text: '一起做一顿冰箱里现有的饭', tags: ['setting:indoor', 'budget:free', 'duration:half'] },
      { category: 'activity', text: '各挑一首歌，边听边聊天', tags: ['setting:indoor', 'budget:free', 'duration:short'] },
      { category: 'place', text: '免费的公园长椅', tags: ['setting:outdoor', 'budget:free', 'duration:short'] },
      { category: 'place', text: '家里最舒服的那个角落', tags: ['setting:indoor', 'budget:free', 'duration:short'] },
      { category: 'surprise', text: '互相写一句今天最想感谢对方的话', tags: ['setting:any', 'budget:free', 'duration:short'] },
      { category: 'surprise', text: '从手机里挑一张照片，讲它背后的故事', tags: ['setting:any', 'budget:free', 'duration:short'] },
    ],
  },
  {
    id: 'half-day',
    title: '偷半天出门',
    description: '不需要计划一整天，留半天给两个人。',
    cards: [
      { category: 'activity', text: '去一个没去过的小街区随便走走', tags: ['setting:outdoor', 'budget:low', 'duration:half'] },
      { category: 'activity', text: '找一家店坐一下午，各做各的事', tags: ['setting:indoor', 'budget:low', 'duration:half'] },
      { category: 'place', text: '有窗边座位的咖啡店', tags: ['setting:indoor', 'budget:low', 'duration:half'] },
      { category: 'place', text: '离家不远的小公园或江边', tags: ['setting:outdoor', 'budget:free', 'duration:half'] },
      { category: 'surprise', text: '路上各自挑一样不超过二十元的小东西', tags: ['setting:any', 'budget:low', 'duration:short'] },
      { category: 'surprise', text: '选一张当天拍的照片，约定下次再来的理由', tags: ['setting:any', 'budget:free', 'duration:short'] },
    ],
  },
]
