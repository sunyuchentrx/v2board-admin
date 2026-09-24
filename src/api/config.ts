import { ADMIN_ENDPOINTS } from './endpoints'
import { call, type CallOptions } from './request'

/**
 * 系统配置。
 *
 * 结构：config/fetch 返回 `{ 分组名: { 字段: 值 } }`，共 11 个分组。
 * config/save 接受**扁平**的字段键值（不带分组），只有 ConfigSave::RULES
 * 白名单里的键会被写入，其余静默丢弃。
 *
 * ⚠️⚠️ **保存配置在 Workerman 模式下是坏的（后端 bug，已实测定位）。**
 *
 * ConfigController::save() 的顺序是：
 *   1. File::put(config/v2board.php)   ← 文件在这里就已经写好了
 *   2. opcache_reset()                  ← 失败则 abort(500,'缓存清除失败…')
 *   3. Artisan::call('config:cache')    ← **在 Workerman 下必然抛异常**
 *   4. posix_kill(WEBMANPID, SIGTERM)   ← 走不到
 *
 * 第 3 步的根因：Artisan::call 会构造 Symfony Console Application，
 * 它默认注册的 DumpCompletionCommand::configure() 读 $_SERVER['PHP_SELF']，
 * 而 AdapterMan 不提供这个键 → ErrorException: Undefined array key "PHP_SELF"。
 * （php-fpm 下有 PHP_SELF，所以只在 Workerman 常驻模式下坏。）
 *
 * 净效果：**配置文件写进去了，但 bootstrap/cache/config.php 没重新生成、
 * 进程也没重启，所以新配置不生效**，而管理员只看到一个 500。
 *
 * 人工补救（服务器上执行）：
 *     php artisan config:cache
 *     php -c cli-php.ini webman.php stop && php -c cli-php.ini webman.php start -d
 *
 * 本项目不改后端（红线），所以 UI 的责任是：把「文件已写入但未生效」这件事
 * 如实说清楚，并给出上面这两条命令，而不是笼统报「保存失败」让人以为没写进去。
 */

/** fetch 返回的完整结构，键是分组名 */
export type ConfigData = Record<string, Record<string, unknown>>

export function fetchConfig() {
  return call<ConfigData>(ADMIN_ENDPOINTS.config.fetch)
}

/** 只取某一个分组（后端支持 key 参数） */
export function fetchConfigGroup(key: string) {
  return call<ConfigData>(ADMIN_ENDPOINTS.config.fetch, { key })
}

/**
 * 保存配置。传扁平键值。
 *
 * ⚠️ 调用后后端会自杀重启，这个 Promise 很可能 reject（连接被切断），
 * 但配置**已经写入**了。调用方不要把 reject 当成保存失败，
 * 应该改为轮询探活确认后端是否恢复。
 *
 * ⚠️ 但反过来，**4xx 一定没写入**：ConfigSave 是 FormRequest，校验在进控制器之前完成，
 * 422 时 File::put 根本没执行；403/404/429 同样发生在中间件或路由层。
 * 只有「没有响应（断连/超时）」和 5xx 才可能是「写了一半」。
 * 而且 ConfigSave 是整单校验：一个字段不合法，同一次提交里所有字段都不写。
 *
 * 所以调用方应传 `{ handle422: true }`，自己把 fieldErrors 落到表单上，
 * 并且绝不能把 422 当成「已写入未生效」。
 *
 * 另外，**只提交确实拿到过或改过的字段**。save 对缺失的键保留旧值，
 * 但对传进来的键无条件覆盖 —— 传一个没回填的开关 0，就等于把它关掉。
 */
export function saveConfig(values: Record<string, unknown>, options?: CallOptions) {
  return call<boolean>(ADMIN_ENDPOINTS.config.save, values, options)
}

/** 可用的邮件模板目录名（resources/views/mail/ 下的子目录） */
export function fetchEmailTemplates() {
  return call<string[]>(ADMIN_ENDPOINTS.config.getEmailTemplate)
}

/** 可用的前台主题目录名（public/theme/ 下的子目录） */
export function fetchThemeTemplates() {
  return call<string[]>(ADMIN_ENDPOINTS.config.getThemeTemplate)
}

/**
 * 给当前登录的管理员邮箱发一封测试邮件。
 * 返回体里带 `log` 字段（SendEmailJob::handle 的返回），失败原因在里面。
 */
export function testSendMail() {
  return call<boolean>(ADMIN_ENDPOINTS.config.testSendMail)
}

/** 设置 Telegram Webhook。要传当前填写的 bot token（后端用它调 getMe/setWebhook） */
export function setTelegramWebhook(botToken: string) {
  return call<boolean>(ADMIN_ENDPOINTS.config.setTelegramWebhook, {
    telegram_bot_token: botToken,
  })
}
