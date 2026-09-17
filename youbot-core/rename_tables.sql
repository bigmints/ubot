DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ubot_%') 
    LOOP
        EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' RENAME TO ' || quote_ident('youbot_' || substring(r.tablename from 6));
    END LOOP;
END $$;
