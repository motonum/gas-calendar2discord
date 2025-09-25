// 設定用定数

const NOTIFICATION_HOUR = 8; // 通知する時間（24時間表記）
const WEEKLY_NOTIFICATION_DAY = 1; // 曜日番号での月曜日（0:日曜, 1:月曜, ..., 6:土曜）

// DiscordのWebhook URLとGoogleカレンダーIDをスクリプトプロパティに設定しておくこと
const DISCORD_WEBHOOK_URL =
  PropertiesService.getScriptProperties().getProperty("DISCORD_WEBHOOK_URL");

const CALENDAR_ID =
  PropertiesService.getScriptProperties().getProperty("CALENDAR_ID");


class ExDate extends Date {
  toFormattedString() {
    return this.toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      weekday: "short"
    })
  }
  omitTime() {
    this.setHours(0, 0, 0, 0);
    return this;
  }
  shiftDate(days = 1) {
    this.setDate(this.getDate() + days);
    return this;
  }
  toDate() {
    return new Date(this.getTime());
  }
  static isSameDay(day1, day2) {
    return day1.getFullYear() === day2.getFullYear()
      && day1.getMonth() === day2.getMonth()
      && day1.getDate() === day2.getDate();
  }
}

// トリガーを設定
// 既存のトリガーは削除してから新規作成する
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
}

// Discordに通知
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

// 通知メッセージを作成
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

// 週の通知メッセージを作成
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
  const sortedDateStrings = uniqueTimestamps.sort((a, b) => a - b).map(time => new ExDate(time).toFormattedString());

  const message = sortedDateStrings
    .map(dateString => {
      const eventTitles = groupedEvents.get(dateString).map(event => `- ${event.getTitle()}`).join("\n");
      return `${dateString}\n${eventTitles}`;
    })
    .join("\n\n");

  return `今週の予定はこちらです\n\n${message}`;
}

// メイン関数
function main() {
  const now = new ExDate();

  const message = (now.getDay() === WEEKLY_NOTIFICATION_DAY)
    ? makeWeeklyNotificationMessage(now)
    : makeDailyNotificationMessage(now);

  if (message) {
    notify(DISCORD_WEBHOOK_URL, message);
  }
}
