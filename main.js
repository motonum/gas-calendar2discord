// 設定用定数

const NOTIFICATION_HOUR = 8; // 通知する時間（24時間表記）
const WEEKLY_NOTIFICATION_DAY = 1; // 曜日番号での月曜日（0:日曜, 1:月曜, ..., 6:土曜）

// DiscordのWebhook URLとGoogleカレンダーIDをスクリプトプロパティに設定しておくこと
const DISCORD_WEBHOOK_URL =
  PropertiesService.getScriptProperties().getProperty("DISCORD_WEBHOOK_URL");

const CALENDAR_ID =
  PropertiesService.getScriptProperties().getProperty("CALENDAR_ID");


/**
 * 標準のDateオブジェクトを拡張し、日付操作のユーティリティメソッドを提供するクラス。
 * @extends {Date}
 */
class ExDate extends Date {
  /**
   * 日付を「M月d日 (ddd)」形式の日本語文字列に変換します。
   * @returns {string} フォーマットされた日付文字列。
   */
  toFormattedString() {
    return this.toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      weekday: "short"
    })
  }
  /**
   * このインスタンスの時刻を0時0分0秒0ミリ秒に設定します（破壊的メソッド）。
   * @returns {ExDate} 時刻がリセットされた自身のインスタンス。
   */
  omitTime() {
    this.setHours(0, 0, 0, 0);
    return this;
  }
  /**
   * このインスタンスの日付を指定された日数だけ前後にずらします（破壊的メソッド）。
   * @param {number} [days=1] - ずらす日数。正の数で未来、負の数で過去に移動します。
   * @returns {ExDate} 日付が変更された自身のインスタンス。
   */
  shiftDate(days = 1) {
    this.setDate(this.getDate() + days);
    return this;
  }
  /**
   * このExDateインスタンスから標準のDateオブジェクトを生成します。
   * @returns {Date} 標準のDateオブジェクト。
   */
  toDate() {
    return new Date(this.getTime());
  }
  /**
   * 2つのDateオブジェクトが同じ年、月、日であるかを比較します。
   * @param {Date} day1 - 比較する1つ目の日付。
   * @param {Date} day2 - 比較する2つ目の日付。
   * @returns {boolean} 2つの日付が同じ日であればtrue、そうでなければfalse。
   */
  static isSameDay(day1, day2) {
    return day1.getFullYear() === day2.getFullYear()
      && day1.getMonth() === day2.getMonth()
      && day1.getDate() === day2.getDate();
  }
}

/**
 * refreshTrigger関数用のトリガーを初期化します。
 * 既に存在する場合は何もせず、存在しない場合は毎日3時に実行されるトリガーを作成します。
 * この関数はmain関数の最初に呼び出され、トリガーが常に存在することを保証します。
 */
function initTrigger() {
  if (ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === "refreshTrigger")) {
    return;
  }
  ScriptApp
    .newTrigger("refreshTrigger")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  Logger.log("refreshTrigger用のトリガーを新規作成しました");
}

/**
 * スクリプトの実行トリガーを再設定します。
 * 既存の'main'関数用トリガーをすべて削除し、指定された時刻に実行される新しいトリガーを作成します。
 */
function refreshTrigger() {
  const allTriggers = ScriptApp.getProjectTriggers();
  allTriggers.filter(trigger => trigger.getHandlerFunction() === "main").forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  })

  const now = new ExDate();

  const next = new ExDate();
  next.setHours(NOTIFICATION_HOUR, 0, 0, 0);

  if (now.getTime() >= next.getTime()) {
    next.shiftDate();
  }

  ScriptApp.newTrigger("main").timeBased().at(next.toDate()).create();
  initTrigger();
}

/**
 * 指定されたURL（Discord Webhook）にメッセージを送信します。
 * @param {string} url - 送信先のWebhook URL。
 * @param {string} message - 送信するメッセージ本文。
 */
function notify(url, message) {
  try {
    UrlFetchApp.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify({ content: message }),
    });
  } catch (e) {
    Logger.log(`Discordへの通知送信に失敗しました: ${e.message}`);
  }
}

/**
 * 指定された日のGoogleカレンダーの予定から、日次通知メッセージを作成します。
 * @param {Date} date - 予定を取得する日付。
 * @returns {string|null} 生成された通知メッセージ。予定がない場合はnull。
 */
function makeDailyNotificationMessage(date) {
  const myCalendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = myCalendar.getEventsForDay(date);
  const eventTitles = events.map(event => event.getTitle());
  if (eventTitles.length === 0) return null;
  const eventListString = eventTitles.map(
    eventTitle => `- ${eventTitle}`
  ).join("\n");
  return `本日の予定はこちらです\n${eventListString}`
}

/**
 * 指定された開始日から1週間分のGoogleカレンダーの予定から、週次通知メッセージを作成します。
 * @param {Date} startAt - 予定を取得し始める日付。
 * @returns {string|null} 生成された通知メッセージ。予定がない場合はnull。
 */
function makeWeeklyNotificationMessage(startAt) {
  const startDate = new ExDate(startAt.getTime()).omitTime();
  const endDate = new ExDate(startAt.getTime()).omitTime().shiftDate(7);

  const myCalendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = myCalendar.getEvents(startDate, endDate);

  // 複数日にまたがる終日イベントを除外
  const singleDayEvents = events.filter(event => {
    if (!event.isAllDayEvent()) return true;
    const start = new ExDate(event.getStartTime());
    const end = new ExDate(event.getEndTime()).shiftDate(-1);
    return ExDate.isSameDay(start, end);
  });

  if (singleDayEvents.length === 0) return null;

  // イベントを日付文字列でグループ化
  const groupedEvents = Map.groupBy(singleDayEvents, (event) => new ExDate(event.getStartTime()).toFormattedString());

  // 日付順にソートされた日付文字列の配列を生成
  const uniqueTimestamps = [...new Set(singleDayEvents.map(event => new ExDate(event.getStartTime()).omitTime().getTime()))];
  const sortedDateStrings = uniqueTimestamps.toSorted((a, b) => a - b).map(time => new ExDate(time).toFormattedString());

  const message = sortedDateStrings
    .map(dateString => {
      const eventTitles = groupedEvents.get(dateString).map(event => `- ${event.getTitle()}`).join("\n");
      return `${dateString}\n${eventTitles}`;
    })
    .join("\n\n");

  return `今週の予定はこちらです\n\n${message}`;
}

/**
 * メイン関数。トリガーによって毎日実行されます。
 * 実行日が指定の曜日（月曜日）であれば週次の予定を、それ以外は当日の予定を通知します。
 */
function main() {
  initTrigger();
  const now = new ExDate();

  const message = (now.getDay() === WEEKLY_NOTIFICATION_DAY)
    ? makeWeeklyNotificationMessage(now)
    : makeDailyNotificationMessage(now);

  if (message) {
    notify(DISCORD_WEBHOOK_URL, message);
  }
}
