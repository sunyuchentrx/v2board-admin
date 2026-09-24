import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { App as AntdApp, ConfigProvider, message, theme as antdTheme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { settings } from '@/settings'

/**
 * 设计系统：全站的颜色、圆角、字体、控件尺寸都从这里出。
 *
 * 页面里不要再写死 #fff / #f0f0f0 这类颜色 —— 暗色模式下会变成一块白板。
 * 需要颜色时用 theme.useToken() 取 token，或用 global.css 里的 CSS 变量。
 */

export type ColorMode = 'light' | 'dark'

const MODE_KEY = 'v2board_admin_v2_theme'

/** window.settings.theme.color（后台「主题色」配置）→ 主色 */
const PRIMARY_BY_SETTING: Record<string, string> = {
  default: '#4f46e5',
  blue: '#2563eb',
  black: '#27272a',
  darkblue: '#1e40af',
  green: '#059669',
}

export const PRIMARY = PRIMARY_BY_SETTING[settings.theme.color] ?? PRIMARY_BY_SETTING.default!

const FONT_FAMILY = [
  "'Inter Variable'",
  '-apple-system',
  'BlinkMacSystemFont',
  "'Segoe UI'",
  "'PingFang SC'",
  "'Hiragino Sans GB'",
  "'Microsoft YaHei UI'",
  "'Microsoft YaHei'",
  'sans-serif',
].join(', ')

export const MONO_FONT =
  "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace"

/** 两种模式下的中性色。侧边栏始终是深色，和内容区拉开层次。 */
const NEUTRAL = {
  light: {
    layout: '#f4f5f8',
    container: '#ffffff',
    elevated: '#ffffff',
    border: '#e3e6ec',
    borderSecondary: '#eceef3',
    fillAlter: '#f8f9fb',
    tableHeader: '#f8f9fb',
    text: '#1f2330',
  },
  dark: {
    layout: '#0c0e13',
    container: '#15181f',
    elevated: '#1c2029',
    border: '#2b303b',
    borderSecondary: '#222631',
    fillAlter: '#191c24',
    tableHeader: '#191c24',
    text: '#e6e8ee',
  },
} as const

export const SIDER_BG = '#0f1219'

/**
 * 暗色下的主色要亮一档：darkAlgorithm 会把 #4f46e5 派生出的文字色 / 链接色压到 #463fc6，
 * 在 #15181f 卡片上对比度只有 2.4:1，「编辑」这类链接和 processing 标签几乎看不清。
 */
const PRIMARY_DARK = '#6366f1'

/** 暗色下各语义色的文字档位，保证小字（12px 标签）在深色底上 ≥ 4.5:1 */
const DARK_TEXT_COLORS = {
  colorPrimaryText: '#a5b4fc',
  colorPrimaryTextHover: '#c7d2fe',
  colorPrimaryTextActive: '#818cf8',
  colorInfoText: '#a5b4fc',
  colorInfoTextHover: '#c7d2fe',
  colorLinkHover: '#a5b4fc',
  colorLinkActive: '#6366f1',
  colorErrorText: '#f87171',
  colorErrorTextHover: '#fca5a5',
  colorSuccessText: '#4ade80',
  colorWarningText: '#fbbf24',
} as const

/** 浅色下 warning / success 默认色在各自的浅底标签上只有约 3:1，文字档加深一级 */
const LIGHT_TEXT_COLORS = {
  colorWarningText: '#b45309',
  colorSuccessText: '#166534',
  colorErrorText: '#b91c1c',
} as const

export function buildTheme(mode: ColorMode): ThemeConfig {
  const n = NEUTRAL[mode]
  const dark = mode === 'dark'
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    // CSS 变量统一叫 --va-*（prefix 会被 kebab 化，含数字的前缀会变成 v-2a，所以用 va），挂在 .v2a 上（antd 用 key 作 class 名；ThemeProvider 会把它也加到 <html>），
    // 这样自定义 CSS（layout.css / global.css）也能用同一套 token，暗色模式自动跟随。
    cssVar: { key: 'v2a', prefix: 'va' },
    hashed: false,
    token: {
      colorPrimary: dark ? PRIMARY_DARK : PRIMARY,
      colorInfo: dark ? PRIMARY_DARK : PRIMARY,
      colorSuccess: '#16a34a',
      colorWarning: '#d97706',
      colorError: '#dc2626',
      // 暗色链接种子要给得比目标更亮：darkAlgorithm 还会再压一档（#a5b4fc → #8f9cd9，在卡片上 6.7:1）
      colorLink: dark ? '#a5b4fc' : PRIMARY,
      ...(dark ? DARK_TEXT_COLORS : LIGHT_TEXT_COLORS),
      colorBgLayout: n.layout,
      colorBgContainer: n.container,
      colorBgElevated: n.elevated,
      colorBorder: n.border,
      colorBorderSecondary: n.borderSecondary,
      colorFillAlter: n.fillAlter,
      colorText: n.text,
      fontFamily: FONT_FAMILY,
      fontFamilyCode: MONO_FONT,
      fontSize: 14,
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      borderRadiusXS: 4,
      controlHeight: 34,
      controlHeightSM: 26,
      controlHeightLG: 40,
      wireframe: false,
      boxShadow:
        '0 6px 16px -8px rgba(15, 18, 25, 0.12), 0 9px 28px 0 rgba(15, 18, 25, 0.06), 0 12px 48px 16px rgba(15, 18, 25, 0.03)',
      boxShadowSecondary:
        '0 6px 16px -8px rgba(15, 18, 25, 0.14), 0 9px 28px 0 rgba(15, 18, 25, 0.08), 0 12px 48px 16px rgba(15, 18, 25, 0.04)',
    },
    components: {
      Layout: {
        siderBg: SIDER_BG,
        headerBg: 'transparent',
        headerHeight: 60,
        headerPadding: '0 24px',
        bodyBg: n.layout,
      },
      Menu: {
        darkItemBg: SIDER_BG,
        darkSubMenuItemBg: SIDER_BG,
        darkItemColor: 'rgba(226, 230, 240, 0.68)',
        darkItemHoverColor: '#ffffff',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
        darkItemSelectedBg: PRIMARY,
        darkItemSelectedColor: '#ffffff',
        darkGroupTitleColor: 'rgba(226, 230, 240, 0.38)',
        itemHeight: 38,
        itemBorderRadius: 8,
        itemMarginInline: 10,
        itemMarginBlock: 2,
        iconSize: 16,
        collapsedIconSize: 17,
        groupTitleFontSize: 12,
      },
      Card: {
        headerFontSize: 15,
        headerHeight: 52,
        headerHeightSM: 42,
        paddingLG: 20,
      },
      Table: {
        headerBg: n.tableHeader,
        headerColor: dark ? 'rgba(230, 232, 238, 0.72)' : '#4a5263',
        headerSplitColor: 'transparent',
        headerBorderRadius: 10,
        rowHoverBg: dark ? '#1b1f28' : '#f7f8fc',
        cellPaddingBlock: 12,
        cellPaddingInline: 14,
        cellPaddingBlockSM: 8,
        // ProTable 默认是 middle 尺寸，走的是 *MD 这一档，不设的话左右只有 8px
        cellPaddingBlockMD: 12,
        cellPaddingInlineMD: 12,
        borderColor: n.borderSecondary,
      },
      Form: {
        // 20 而不是 18：校验报错会占掉这段间距，太小会让报错文字贴着下一行的标签
        itemMarginBottom: 20,
        verticalLabelPadding: '0 0 6px',
        labelColor: dark ? 'rgba(230, 232, 238, 0.85)' : '#3a4150',
      },
      Button: {
        fontWeight: 500,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        paddingInline: 14,
      },
      Input: { paddingInline: 11 },
      InputNumber: { paddingInline: 11 },
      Select: { optionSelectedFontWeight: 500, optionHeight: 34 },
      Modal: {
        titleFontSize: 16,
        contentBg: n.elevated,
        headerBg: n.elevated,
        footerBg: n.elevated,
      },
      Drawer: { footerPaddingBlock: 12, footerPaddingInline: 20 },
      Tabs: { horizontalItemGutter: 28, titleFontSize: 14 },
      Tag: { defaultBg: n.fillAlter },
      Divider: { orientationMargin: 0, textPaddingInline: '0 12px' },
      Descriptions: { labelBg: n.fillAlter },
      // 暗色下弹窗底色（elevated）比容器色亮，选中项若用容器色会像陷进去的洞；改成比弹窗更亮的一档
      Segmented: dark
        ? { itemSelectedBg: '#2b303b', trackBg: n.container, itemSelectedColor: '#ffffff' }
        : { itemSelectedBg: n.container },
      Statistic: { contentFontSize: 26 },
      Alert: { withDescriptionPadding: '14px 16px' },
      Pagination: { itemActiveBg: n.container },
      Tooltip: { colorBgSpotlight: dark ? '#2b303b' : '#1f2330' },
    },
  }
}

/** 关掉「两个汉字按钮自动插空格」：「保 存」「取 消」和四字按钮放在一起不统一 */
const BUTTON_CONFIG = { autoInsertSpace: false } as const

/**
 * 全局提示下移到顶栏（60px）之下：默认 top 8px 会压住顶栏按钮和抽屉右上角的关闭按钮。
 * App.tsx 里的 <AntdApp> 也要传同一个配置（接口错误提示走的是 useApp 的实例）。
 */
export const MESSAGE_CONFIG = { top: 72 } as const

function initialMode(): ColorMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 隐私模式下 localStorage 可能抛异常，退回跟随系统
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ColorModeValue {
  mode: ColorMode
  toggle: () => void
}

const ColorModeContext = createContext<ColorModeValue>({ mode: 'light', toggle: () => {} })

export function useColorMode(): ColorModeValue {
  return useContext(ColorModeContext)
}

/**
 * 包住整个应用：antd 主题 + 暗色模式 + 让 Modal.confirm / message 等静态方法也吃到主题。
 *
 * 页面里大量直接调用 antd 的静态方法（Modal.confirm、message.success），
 * 它们默认渲染在 ConfigProvider 之外、拿不到自定义 token。
 * ConfigProvider.config({ holderRender }) 把它们也包进同一套主题里。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(initialMode)
  const themeConfig = useMemo(() => buildTheme(mode), [mode])

  const toggle = useCallback(() => {
    setMode((m) => {
      const next = m === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(MODE_KEY, next)
      } catch {
        // 忽略：只是记不住偏好
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    document.documentElement.classList.add('v2a')
    document.documentElement.style.colorScheme = mode
    ConfigProvider.config({
      holderRender: (node) => (
        <ConfigProvider locale={zhCN} theme={themeConfig} button={BUTTON_CONFIG}>
          <AntdApp message={MESSAGE_CONFIG}>{node}</AntdApp>
        </ConfigProvider>
      ),
    })
    // 页面里直接 import { message } from 'antd' 的静态调用也用同一个位置
    message.config(MESSAGE_CONFIG)
  }, [mode, themeConfig])

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle])

  return (
    <ColorModeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={themeConfig} button={BUTTON_CONFIG}>
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  )
}
