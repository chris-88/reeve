-- P1-F10.4 and F10.5: the two honest measures of whether the self-change loop
-- is working, and whether it is quietly eating the system's purpose.

-- ---------------------------------------------------------------------------
-- F10.4: capture-to-shipped lead time.
--
-- The only honest measure of whether the loop is working — how long a thought
-- takes to travel from a dictated note to a merged, deployed change. Measured
-- from the earliest source capture, because that is when the thought was had.
--
-- security_invoker so the change_requests and captures policies still apply.
-- ---------------------------------------------------------------------------
create view change_request_leadtime with (security_invoker = true) as
select
  cr.user_id,
  cr.id                                                                as change_request_id,
  cr.title,
  min(c.created_at)                                                    as first_capture_at,
  cr.shipped_at,
  round(extract(epoch from (cr.shipped_at - min(c.created_at))) / 86400.0, 2) as lead_days
from change_requests cr
join change_request_captures crc on crc.change_request_id = cr.id
join captures c on c.id = crc.capture_id
where cr.status = 'shipped' and cr.shipped_at is not null
group by cr.user_id, cr.id, cr.title, cr.shipped_at;

-- ---------------------------------------------------------------------------
-- F10.5: the `reeve` share of captures, weekly.
--
-- §7's warning made measurable: "the most seductive failure mode available to
-- this project is that Reeve becomes a tool for building Reeve, and nothing
-- else." A rising share means the tool is eating its own purpose. This metric
-- exists to be acted on, not admired — treat a rising `reeve` share as a
-- warning rather than as engagement.
--
-- Filed area, so a re-file corrects the count the same way the corrections
-- report reads it.
-- ---------------------------------------------------------------------------
create view reeve_capture_share with (security_invoker = true) as
select
  user_id,
  date_trunc('week', created_at at time zone 'Europe/Dublin')::date    as week,
  count(*)::int                                                         as captures,
  count(*) filter (where coalesce(corrected_area_id, area_id) = 'reeve')::int as reeve,
  round(100.0 * count(*) filter (where coalesce(corrected_area_id, area_id) = 'reeve')
        / nullif(count(*), 0), 1)                                       as reeve_pct
from captures
where status = 'done'
group by user_id, date_trunc('week', created_at at time zone 'Europe/Dublin');
