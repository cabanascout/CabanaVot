SELECT
  (json_extract(data, '$.pushSubscriptions') IS NULL) AS no_subs_field,
  json_array_length(json_extract(data, '$.pushSubscriptions')) AS subs_total
FROM app_state;
