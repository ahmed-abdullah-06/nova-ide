import { useEffect, type ReactNode } from 'react';
import { useWorkspace } from '../../../stores/workspace';
import type { Notification } from '../../../stores/workspaceReducer';

/**
 * Auto-dismissing toast for filesystem/workspace feedback (spec §10).
 * One shared surface instead of scattered alerts: errors stay for 10 s,
 * informational messages for 5 s, and every toast can be dismissed.
 */
function NotificationItem({
  notification,
}: {
  notification: Notification;
}): ReactNode {
  const { dispatch } = useWorkspace();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'dismiss-notification', id: notification.id });
    }, notification.kind === 'error' ? 10_000 : 5_000);
    return () => window.clearTimeout(timeout);
  }, [notification.id, notification.kind, dispatch]);

  return (
    <div
      className={`notification notification--${notification.kind}`}
      role={notification.kind === 'error' ? 'alert' : 'status'}
    >
      <span className="notification__message">{notification.message}</span>
      <button
        type="button"
        className="notification__dismiss"
        aria-label="Dismiss notification"
        onClick={() =>
          dispatch({ type: 'dismiss-notification', id: notification.id })
        }
      >
        ×
      </button>
    </div>
  );
}

export function NotificationHost(): ReactNode {
  const { state } = useWorkspace();
  if (state.notifications.length === 0) {
    return null;
  }
  return (
    <div className="notification-host" aria-live="polite">
      {state.notifications.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
