create view public.member_directory with (security_invoker = true) as
SELECT p.id,
    p.full_name,
        CASE
            WHEN p.id = auth.uid() OR is_admin_or_coordinator() THEN p.email
            ELSE NULL::text
        END AS email,
        CASE
            WHEN p.id = auth.uid() OR is_admin_or_coordinator() THEN p.student_number
            ELSE NULL::text
        END AS student_number,
    p.role,
    p.status,
    p.cell_id,
    p.bsc_id,
    b.name AS bsc_name,
    p.avatar_url,
    p.joined_at
   FROM profiles p
     LEFT JOIN bscs b ON b.id = p.bsc_id
  WHERE p.id = auth.uid() OR is_admin_or_coordinator() OR is_cell_leader_for_profile(p.id);
