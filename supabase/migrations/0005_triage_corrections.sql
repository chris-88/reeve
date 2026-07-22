-- P1-F3: read corrected_area_id.
--
-- Re-filing has been recorded as a signal rather than a correction since
-- Phase 0 — the column is written every time Chris moves a capture, and the
-- comment in CaptureDetail.tsx explains why it is never overwritten.
--
-- Nothing has ever read it. README.md meanwhile calls classifier_hint "the
-- single biggest lever on classification quality", and this column is the only
-- evidence about which hint is wrong. Two views connect the two.
--
-- security_invoker so the policies on captures and areas still apply. Without
-- it a view is queried with the definer's rights, which would quietly hand
-- back the cross-tenant read that 0003 just closed.

-- ---------------------------------------------------------------------------
-- Which pairs get confused, and what the two hints actually say.
--
-- P1-F3.4: the hints are in the view, not left to a second lookup. The point
-- of the report is that the fix is visible in the output.
-- ---------------------------------------------------------------------------
create view triage_corrections with (security_invoker = true) as
select
  c.user_id,
  c.area_id                                            as predicted_area_id,
  predicted.label                                      as predicted_label,
  predicted.classifier_hint                            as predicted_hint,
  c.corrected_area_id,
  corrected.label                                      as corrected_label,
  corrected.classifier_hint                            as corrected_hint,
  count(*)::int                                        as corrections,
  max(c.corrected_at)                                  as last_corrected_at,
  (array_agg(c.id order by c.corrected_at desc))[1:5]  as sample_capture_ids
from captures c
join areas predicted
  on predicted.owner_id = c.user_id and predicted.id = c.area_id
join areas corrected
  on corrected.owner_id = c.user_id and corrected.id = c.corrected_area_id
where c.corrected_area_id is not null
group by
  c.user_id,
  c.area_id, predicted.label, predicted.classifier_hint,
  c.corrected_area_id, corrected.label, corrected.classifier_hint;

-- ---------------------------------------------------------------------------
-- The two headline rates, by week.
--
-- P1-F3.2: they are different problems with different fixes. A rising unsorted
-- rate means the taxonomy has a gap — an area is missing. A rising correction
-- rate concentrated on one pair means a specific hint is wrong. Reading them
-- as one number would hide both.
-- ---------------------------------------------------------------------------
create view triage_rates with (security_invoker = true) as
select
  user_id,
  date_trunc('week', created_at)::date                                     as week,
  count(*)::int                                                            as captures,
  count(*) filter (where corrected_area_id is not null)::int               as corrections,
  count(*) filter (where area_id = 'unsorted')::int                        as unsorted,
  round(100.0 * count(*) filter (where corrected_area_id is not null)
        / nullif(count(*), 0), 1)                                          as correction_rate,
  round(100.0 * count(*) filter (where area_id = 'unsorted')
        / nullif(count(*), 0), 1)                                          as unsorted_rate
from captures
where status = 'done'
group by user_id, date_trunc('week', created_at);
