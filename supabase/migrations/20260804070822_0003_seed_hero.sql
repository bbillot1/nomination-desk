-- Hero seed (BUILD_SPEC §6). Canonical fixture: every volume and dollar figure here is
-- asserted by tests/engines.test.ts. All data is synthetic.
--
-- Gas day D is bound to current_date so a replay uses the active scenario date. Only the date
-- moves; every canonical volume is fixed. CT timestamps are built as local wall-clock times
-- in America/Chicago per the §5 time convention.

insert into pipelines (id, name, kind, operator, tariff_ref) values
  ('ETX-NTX', 'North Texas Corridor', 'intrastate',
   'North Texas Corridor Pipeline Company (synthetic)', 'GT&C (synthetic)');

-- corridor_seq ascends downstream. Delivery and storage points carry the position of the
-- junction they hang off, which is what makes RP-BETH provably downstream of SEG-2.
insert into points (id, pipeline_id, name, point_type, corridor_seq, meter_id) values
  ('RP-WAHA',     'ETX-NTX', 'Waha Hub',                     'receipt',  1, 'MTR-WAHA'),
  ('RP-MIDL',     'ETX-NTX', 'Midland Junction',             'receipt',  2, 'MTR-MIDL'),
  ('JCT-ABIL',    'ETX-NTX', 'Abilene Junction',             'junction', 3, null),
  ('JCT-DFWS',    'ETX-NTX', 'DFW South',                    'junction', 4, null),
  ('RP-BETH',     'ETX-NTX', 'Bethel Storage',               'storage',  3, 'MTR-BETH'),
  ('DP-LSPP-GEN', 'ETX-NTX', 'Lone Star Generating Station', 'delivery', 3, 'MTR-LSPP'),
  ('DP-ABIL-DC',  'ETX-NTX', 'Abilene Data Center',          'delivery', 3, 'MTR-ABDC'),
  ('DP-DFW-LDC',  'ETX-NTX', 'DFW City Gate',                'delivery', 4, 'MTR-DFWG'),
  ('DP-INDL',     'ETX-NTX', 'Industrial Tap',               'delivery', 3, 'MTR-INDL');

insert into segments
  (id, pipeline_id, name, from_point, to_point, design_capacity_dth, operating_capacity_dth, seq)
values
  ('SEG-1', 'ETX-NTX', 'Waha Hub to Midland Junction',
   'RP-WAHA', 'RP-MIDL', 1200000, 1200000, 1),
  ('SEG-2', 'ETX-NTX', 'Midland Junction to Abilene Junction',
   'RP-MIDL', 'JCT-ABIL', 900000, 900000, 2),
  ('SEG-3', 'ETX-NTX', 'Abilene Junction to DFW South',
   'JCT-ABIL', 'JCT-DFWS', 1400000, 1400000, 3);

insert into shippers (id, name, shipper_type, duns, contact_email) values
  ('LSPP', 'Lone Star Power Partners',  'power_gen',   '00-000-0001',
   'gasdesk@lonestarpower.example'),
  ('ABCL', 'Abilene Compute LLC',       'data_center', '00-000-0002',
   'ops@abilenecompute.example'),
  ('NTGU', 'North Texas Gas Utility',   'ldc',         '00-000-0003',
   'scheduling@ntgu.example'),
  ('CEMK', 'Cardinal Energy Marketing', 'marketer',    '00-000-0004',
   'desk@cardinalenergy.example'),
  ('SABT', 'Sabine Trading Co',         'marketer',    '00-000-0005',
   'desk@sabinetrading.example');

insert into contracts
  (id, shipper_id, pipeline_id, contract_number, service_type, mdq_dth,
   primary_receipt_point, primary_delivery_point, storage_rights_dth, storage_point,
   effective_start, effective_end)
values
  ('CTR-LSPP-FT1', 'LSPP', 'ETX-NTX', 'FT-2024-0117', 'FT', 250000,
   'RP-WAHA', 'DP-LSPP-GEN', 40000, 'RP-BETH',
   current_date - 365, current_date + 365),
  ('CTR-ABCL-FT1', 'ABCL', 'ETX-NTX', 'FT-2025-0042', 'FT', 300000,
   'RP-WAHA', 'DP-ABIL-DC', 0, null,
   current_date - 365, current_date + 365),
  ('CTR-NTGU-FT1', 'NTGU', 'ETX-NTX', 'FT-2019-0008', 'FT', 180000,
   'RP-MIDL', 'DP-DFW-LDC', 0, null,
   current_date - 365, current_date + 365),
  ('CTR-CEMK-IT1', 'CEMK', 'ETX-NTX', 'IT-2025-0311', 'IT', null,
   'RP-WAHA', 'DP-INDL', 0, null,
   current_date - 365, current_date + 365),
  ('CTR-SABT-IT1', 'SABT', 'ETX-NTX', 'IT-2025-0329', 'IT', null,
   'RP-MIDL', 'DP-INDL', 0, null,
   current_date - 365, current_date + 365);

-- §6.5. Citations are synthetic and marked as such in the data itself.
insert into tariff_rules
  (id, pipeline_id, rule_type, rule_key, value_numeric, value_text, citation)
values
  ('TR-SP-FP',  'ETX-NTX', 'scheduling_priority', 'firm_primary',
   1, null, 'GT&C §12.1 (synthetic)'),
  ('TR-SP-FS',  'ETX-NTX', 'scheduling_priority', 'firm_secondary',
   2, null, 'GT&C §12.2 (synthetic)'),
  ('TR-SP-IT',  'ETX-NTX', 'scheduling_priority', 'interruptible',
   3, null, 'GT&C §12.4 (synthetic)'),
  ('TR-PM-IT',  'ETX-NTX', 'proration_method', 'it_prorata',
   null, 'pro_rata_by_nomination', 'GT&C §12.6 (synthetic)'),
  ('TR-TOL-S2', 'ETX-NTX', 'tolerance', 'stage_2_pct',
   5.0, null, 'GT&C §52.3 (synthetic)'),
  ('TR-TOL-S3', 'ETX-NTX', 'tolerance', 'stage_3_pct',
   3.0, null, 'GT&C §52.4 (synthetic)'),
  ('TR-PEN-S2', 'ETX-NTX', 'ofo_penalty', 'stage_2_rate_cents_dth',
   2500, null, 'GT&C §52.3 (synthetic)'),
  ('TR-PEN-S3', 'ETX-NTX', 'ofo_penalty', 'stage_3_rate_cents_dth',
   5000, null, 'GT&C §52.4 (synthetic)');

-- §6.1 timeline. ID3 is the only cycle still open at the 16:00 baseline.
insert into cycles (id, pipeline_id, gas_day, cycle_type, deadline_ct, status) values
  ('CYC-TIMELY', 'ETX-NTX', current_date, 'timely',
   ((current_date - 1) + time '13:00') at time zone 'America/Chicago', 'closed'),
  ('CYC-EVENING', 'ETX-NTX', current_date, 'evening',
   ((current_date - 1) + time '18:00') at time zone 'America/Chicago', 'closed'),
  ('CYC-ID1', 'ETX-NTX', current_date, 'id1',
   (current_date + time '10:00') at time zone 'America/Chicago', 'closed'),
  ('CYC-ID2', 'ETX-NTX', current_date, 'id2',
   (current_date + time '14:00') at time zone 'America/Chicago', 'closed'),
  ('CYC-ID3', 'ETX-NTX', current_date, 'id3',
   (current_date + time '19:00') at time zone 'America/Chicago', 'open');

-- §6.3 nominations with the §6.4 published Timely allocation already applied:
-- firm in full (730,000), IT prorated at 0.68 to 102,000 / 68,000. Total 900,000.
insert into nominations
  (id, cycle_id, contract_id, shipper_id, receipt_point, delivery_point,
   priority_rank, nominated_dth, scheduled_dth, status, created_at)
values
  ('NOM-TIMELY-LSPP', 'CYC-TIMELY', 'CTR-LSPP-FT1', 'LSPP',
   'RP-WAHA', 'DP-LSPP-GEN', 1, 250000, 250000, 'scheduled',
   ((current_date - 1) + time '12:30') at time zone 'America/Chicago'),
  ('NOM-TIMELY-ABCL', 'CYC-TIMELY', 'CTR-ABCL-FT1', 'ABCL',
   'RP-WAHA', 'DP-ABIL-DC', 1, 300000, 300000, 'scheduled',
   ((current_date - 1) + time '12:30') at time zone 'America/Chicago'),
  ('NOM-TIMELY-NTGU', 'CYC-TIMELY', 'CTR-NTGU-FT1', 'NTGU',
   'RP-MIDL', 'DP-DFW-LDC', 1, 180000, 180000, 'scheduled',
   ((current_date - 1) + time '12:30') at time zone 'America/Chicago'),
  ('NOM-TIMELY-CEMK', 'CYC-TIMELY', 'CTR-CEMK-IT1', 'CEMK',
   'RP-WAHA', 'DP-INDL', 3, 150000, 102000, 'scheduled',
   ((current_date - 1) + time '12:45') at time zone 'America/Chicago'),
  ('NOM-TIMELY-SABT', 'CYC-TIMELY', 'CTR-SABT-IT1', 'SABT',
   'RP-MIDL', 'DP-INDL', 3, 100000, 68000, 'scheduled',
   ((current_date - 1) + time '12:45') at time zone 'America/Chicago');

-- §6.8 measured takes at each shipper's delivery meter, flow_hours 0-5 (09:00-15:00 CT).
-- Each six-hour total is exactly one quarter of its projected daily total.
insert into actual_flows (point_id, shipper_id, gas_day, flow_hour, volume_dth) values
  ('DP-LSPP-GEN', 'LSPP', current_date, 0, 10500),
  ('DP-LSPP-GEN', 'LSPP', current_date, 1, 11000),
  ('DP-LSPP-GEN', 'LSPP', current_date, 2, 11500),
  ('DP-LSPP-GEN', 'LSPP', current_date, 3, 12250),
  ('DP-LSPP-GEN', 'LSPP', current_date, 4, 13000),
  ('DP-LSPP-GEN', 'LSPP', current_date, 5, 13625),
  ('DP-ABIL-DC',  'ABCL', current_date, 0, 12750),
  ('DP-ABIL-DC',  'ABCL', current_date, 1, 13000),
  ('DP-ABIL-DC',  'ABCL', current_date, 2, 13250),
  ('DP-ABIL-DC',  'ABCL', current_date, 3, 13500),
  ('DP-ABIL-DC',  'ABCL', current_date, 4, 13750),
  ('DP-ABIL-DC',  'ABCL', current_date, 5, 14000),
  ('DP-DFW-LDC',  'NTGU', current_date, 0, 7425),
  ('DP-DFW-LDC',  'NTGU', current_date, 1, 7425),
  ('DP-DFW-LDC',  'NTGU', current_date, 2, 7425),
  ('DP-DFW-LDC',  'NTGU', current_date, 3, 7425),
  ('DP-DFW-LDC',  'NTGU', current_date, 4, 7425),
  ('DP-DFW-LDC',  'NTGU', current_date, 5, 7425),
  ('DP-INDL', 'CEMK', current_date, 0, 2250),
  ('DP-INDL', 'CEMK', current_date, 1, 2250),
  ('DP-INDL', 'CEMK', current_date, 2, 2250),
  ('DP-INDL', 'CEMK', current_date, 3, 2250),
  ('DP-INDL', 'CEMK', current_date, 4, 2250),
  ('DP-INDL', 'CEMK', current_date, 5, 2250),
  ('DP-INDL', 'SABT', current_date, 0, 1480),
  ('DP-INDL', 'SABT', current_date, 1, 1479),
  ('DP-INDL', 'SABT', current_date, 2, 1479),
  ('DP-INDL', 'SABT', current_date, 3, 1479),
  ('DP-INDL', 'SABT', current_date, 4, 1479),
  ('DP-INDL', 'SABT', current_date, 5, 1479);

-- §6.1 / §12.1 hero scenario parameters and engine-computed answer key.
insert into scenario_state (id, seed, gas_day, sim_clock_ct, phase, params, answer_key) values (
  1,
  'hero',
  current_date,
  (current_date + time '16:00') at time zone 'America/Chicago',
  'baseline',
  jsonb_build_object(
    'derated_capacity_dth', 820000,
    'incident_time_ct', '16:15',
    'notice', jsonb_build_object(
      'stage', 'Stage 2',
      'tolerance_pct', 5.0,
      'penalty_rate_cents_dth', 2500
    ),
    'it_nominations_dth', jsonb_build_object('CEMK', 150000, 'SABT', 100000),
    'flow_deviation_bps', jsonb_build_object(
      'LSPP', 1500, 'ABCL', 700, 'NTGU', -100, 'CEMK', 0, 'SABT', -140
    )
  ),
  jsonb_build_object(
    'timely', jsonb_build_object(
      'proration_factor', '0.6800',
      'scheduled_dth', jsonb_build_object('CEMK', 102000, 'SABT', 68000)
    ),
    'recut', jsonb_build_object(
      'proration_factor', '0.3600',
      'scheduled_dth', jsonb_build_object('CEMK', 54000, 'SABT', 36000),
      'cuts_dth', jsonb_build_object('CEMK', 48000, 'SABT', 32000)
    ),
    'exposure_cents', jsonb_build_object(
      'LSPP', 62500000, 'ABCL', 15000000, 'NTGU', 0, 'CEMK', 0, 'SABT', 0
    ),
    'violators', jsonb_build_array('LSPP', 'ABCL'),
    'compliant', jsonb_build_array('NTGU', 'CEMK', 'SABT')
  )
);
