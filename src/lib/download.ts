/**
 * 把文本内容触发成浏览器下载。
 *
 * 用于后端那两个直接 echo 文本的接口（user/dumpCSV、批量 user/generate）——
 * 它们不返回 JSON，内容也不适合只显示在页面上（批量生成的 CSV 里有明文密码，
 * 关掉弹窗就再也取不回来）。
 */
export function downloadText(
  content: string,
  filename: string,
  mimeType = 'text/csv;charset=utf-8',
): void {
  // 后端 dumpCSV 自己带了 UTF-8 BOM，批量 generate 没带。
  // 没有 BOM 时补上，否则 Excel 打开中文会乱码。
  const needsBom = !content.startsWith('﻿')
  const blob = new Blob([needsBom ? `﻿${content}` : content], {
    type: mimeType,
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 立即 revoke 在部分浏览器会打断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
