// Supabase client initialization
// The CDN creates window.supabase as the library module.
// We create the client and expose it as a global `supabase` variable.
var supabase = window.supabase.createClient(
  'https://pgxvaxbpuwdwcfulkrdz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBneHZheGJwdXdkd2NmdWxrcmR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMDY2MzIsImV4cCI6MjEwMjU4MjYzMn0.GvjgQSht_QGnBJuWzqq5hxkzI3VuXArd8Usoy-QhL68'
);
