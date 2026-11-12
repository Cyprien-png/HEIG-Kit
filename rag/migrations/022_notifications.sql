-- Notifications of the web application (src/accounts/notifications.ts, docs/notifications.md): the devices on which an
-- account turned them on (Web Push subscriptions) and the kinds it wants. Reached by the server itself only.
CREATE TABLE push_subscriptions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The address the browser's push service gave for this device, and the keys that encrypt what is sent to it.
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- No row: every kind is wanted.
CREATE TABLE notification_prefs (
  user_id bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  document boolean NOT NULL DEFAULT true,
  correction boolean NOT NULL DEFAULT true,
  courses boolean NOT NULL DEFAULT true
);

REVOKE ALL ON push_subscriptions, notification_prefs FROM heigkit_app;
REVOKE ALL ON SEQUENCE push_subscriptions_id_seq FROM heigkit_app;
