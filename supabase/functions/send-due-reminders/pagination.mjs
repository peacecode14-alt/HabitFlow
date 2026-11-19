export async function forEachSchedulePage(admin, onSchedule, pageSize = 500) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("pageSize must be a positive integer.");
  }

  let lastId = null;

  while (true) {
    let query = admin
      .from("reminder_schedules")
      .select(
        "id,firebase_uid,reminder_time,timezone,repeat_days,notification_body,updated_at",
      )
      .eq("enabled", true)
      .order("id", { ascending: true })
      .limit(pageSize);

    if (lastId !== null) {
      query = query.gt("id", lastId);
    }

    const { data: schedules, error } = await query;

    if (error) throw error;
    if (!schedules?.length) break;

    for (const schedule of schedules) {
      await onSchedule(schedule);
    }

    lastId = schedules[schedules.length - 1].id;

    if (schedules.length < pageSize) break;
  }
}
