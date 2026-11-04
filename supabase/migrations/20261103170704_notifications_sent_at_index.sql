-- S12a (code review): the Probes page's "Delivery · 24 h" counts sent messages by `sent_at`. Without
-- this, `status = 'sent'` through notifications_due_idx reads every sent row ever kept (delivery records
-- have no retention). Partial: only sent rows have a `sent_at`. Failed rows stay few and use the
-- status prefix of notifications_due_idx.
create index notifications_sent_at_idx on public.notifications (sent_at) where status = 'sent';
