-- Remove the obsolete role-view override state. Authorization now always uses
-- the profile's actual role, and no application code reads or writes this field.
ALTER TABLE public.sessions DROP CONSTRAINT sessions_role_view_check;
ALTER TABLE public.sessions DROP COLUMN role_view;
