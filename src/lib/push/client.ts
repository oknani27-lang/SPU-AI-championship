export async function pushApi(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "เชื่อมต่อการแจ้งเตือนไม่สำเร็จ");
  return data;
}

export async function disablePushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  await pushApi("/api/push/subscriptions", "DELETE", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
