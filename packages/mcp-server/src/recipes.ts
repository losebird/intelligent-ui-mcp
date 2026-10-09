/**
 * Narrow recipe trees for high-frequency natural asks.
 * Use only registered catalog types. Placeholder metrics are intentional.
 */

export const RECIPE_RESOURCE_BOARD = {
  id: "root",
  type: "catalog.base/Stack",
  props: { direction: "vertical", gap: 12 },
  children: [
    {
      id: "host",
      type: "catalog.base/Text",
      props: { text: "Hiyouga-Air.local", variant: "title" },
    },
    {
      id: "tiles",
      type: "catalog.base/Grid",
      props: { columns: 4, gap: 12 },
      children: [
        {
          id: "cpu",
          type: "catalog.shadcn/Card",
          props: { title: "CPU", description: "13%" },
          children: [
            {
              id: "cpu_p",
              type: "catalog.shadcn/Progress",
              props: { value: 13, label: "CPU" },
            },
          ],
        },
        {
          id: "mem",
          type: "catalog.shadcn/Card",
          props: { title: "内存", description: "15.8 / 16 GB" },
          children: [
            {
              id: "mem_p",
              type: "catalog.shadcn/Progress",
              props: { value: 99, label: "已用" },
            },
          ],
        },
        {
          id: "disk",
          type: "catalog.shadcn/Card",
          props: { title: "磁盘", description: "330 GB /" },
          children: [
            {
              id: "disk_p",
              type: "catalog.shadcn/Progress",
              props: { value: 72, label: "/" },
            },
          ],
        },
        {
          id: "load",
          type: "catalog.shadcn/Card",
          props: { title: "负载", description: "2.47" },
          children: [
            {
              id: "load_t",
              type: "catalog.base/Text",
              props: { text: "2.47", variant: "title" },
            },
          ],
        },
      ],
    },
  ],
} as const;

export const RECIPE_WEATHER_CARD = {
  id: "root",
  type: "catalog.base/Stack",
  props: { direction: "vertical", gap: 12 },
  children: [
    {
      id: "now",
      type: "catalog.shadcn/Card",
      props: { title: "北京 · 阴", description: "25°C · 体感 23°C" },
      children: [
        {
          id: "meta",
          type: "catalog.base/Markdown",
          props: {
            text: "最高 26° / 最低 14° · 湿度 36% · 南风 11 km/h",
          },
        },
      ],
    },
    {
      id: "hourly",
      type: "catalog.charts/LineChart",
      props: {
        title: "逐小时",
        height: 140,
        data: [
          { label: "16:00", value: 26 },
          { label: "17:00", value: 25 },
          { label: "18:00", value: 23 },
          { label: "19:00", value: 22 },
          { label: "20:00", value: 21 },
        ],
      },
    },
    {
      id: "daily",
      type: "catalog.charts/BarChart",
      props: {
        title: "未来几天最高温",
        data: [
          { label: "今天", value: 26 },
          { label: "周六", value: 27 },
          { label: "周日", value: 26 },
        ],
      },
    },
  ],
} as const;

export const RECIPE_INTAKE_FORM = {
  id: "root",
  type: "catalog.shadcn/Form",
  props: { submitLabel: "开始写" },
  children: [
    {
      id: "heading",
      type: "catalog.base/Markdown",
      props: { text: "### 博士论文写作需求" },
    },
    {
      id: "field",
      type: "catalog.shadcn/ButtonGroup",
      props: {
        options: [
          { id: "cs", label: "计算机科学" },
          { id: "econ", label: "经济学" },
          { id: "edu", label: "教育学" },
          { id: "mat", label: "材料科学" },
          { id: "other", label: "其他" },
        ],
      },
    },
    {
      id: "topic",
      type: "catalog.shadcn/Input",
      props: {
        label: "研究题目或关键词",
        placeholder: "例：面向小样本的图神经网络推荐",
      },
    },
    {
      id: "lang",
      type: "catalog.shadcn/ButtonGroup",
      props: {
        options: [
          { id: "zh", label: "中文" },
          { id: "en", label: "English" },
        ],
      },
    },
    {
      id: "fmt",
      type: "catalog.shadcn/ButtonGroup",
      props: {
        options: [
          { id: "md", label: "Markdown 单文件" },
          { id: "tex", label: "LaTeX" },
        ],
      },
    },
  ],
} as const;

export const NATURAL_ASK_RECIPES = {
  resource_board: RECIPE_RESOURCE_BOARD,
  weather_card: RECIPE_WEATHER_CARD,
  intake_form: RECIPE_INTAKE_FORM,
} as const;
