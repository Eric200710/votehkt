-- ==============================================================================
-- VOTEHK 蹺蹺板投票系統：資料表、門禁 (RLS)、安全投票函數
-- 用法：Supabase 左側 SQL Editor -> 貼上整份 -> Run
-- ==============================================================================

-- 1. 建立 votes 資料表
create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  choice     text not null check (choice in ('left', 'right')),
  created_at timestamptz not null default now()
);

-- 加快查詢速度的索引
create index if not exists idx_votes_user_created on public.votes (user_id, created_at desc);
create index if not exists idx_votes_choice on public.votes (choice);

-- 2. 開啟 RLS (Row Level Security) 門禁
alter table public.votes enable row level security;

-- 3. 清理舊的 policies
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'votes' loop
    execute format('drop policy %I on public.votes', p.policyname);
  end loop;
end $$;

-- 4. 門禁規則：
-- 使用者只能讀取「自己投過的票紀錄」
create policy "本人可查看自己的投票紀錄" on public.votes
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 5. 安全投票 RPC 函數（保證 5 分鐘冷卻時間與原子性，回傳目前總票數）
create or replace function public.cast_vote(p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_last_vote timestamptz;
  v_seconds_since integer;
  v_cooldown integer := 300; -- 5 分鐘 = 300 秒
  v_left_count bigint;
  v_right_count bigint;
begin
  -- 取得呼叫者 ID
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception '請先登入帳號後再投票';
  end if;

  if p_choice not in ('left', 'right') then
    raise exception '無效的投票選項';
  end if;

  -- 檢查該使用者最近一次投票時間
  select created_at into v_last_vote
  from public.votes
  where user_id = v_user_id
  order by created_at desc
  limit 1;

  if v_last_vote is not null then
    v_seconds_since := extract(epoch from (now() - v_last_vote))::integer;
    if v_seconds_since < v_cooldown then
      raise exception '每 5 分鐘只能投票一次，請等待 % 秒後再試', (v_cooldown - v_seconds_since);
    end if;
  end if;

  -- 寫入投票紀錄
  insert into public.votes (user_id, choice, created_at)
  values (v_user_id, p_choice, now());

  -- 統計最新票數
  select count(*) into v_left_count from public.votes where choice = 'left';
  select count(*) into v_right_count from public.votes where choice = 'right';

  return jsonb_build_object(
    'success', true,
    'left_count', v_left_count,
    'right_count', v_right_count,
    'last_vote_time', now()
  );
end;
$$;

-- 6. 公開/登入者讀取整體蹺蹺板票數的函數（不洩露是誰投的，保護隱私）
create or replace function public.get_seesaw_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left_count bigint;
  v_right_count bigint;
begin
  select count(*) into v_left_count from public.votes where choice = 'left';
  select count(*) into v_right_count from public.votes where choice = 'right';

  return jsonb_build_object(
    'left_count', v_left_count,
    'right_count', v_right_count
  );
end;
$$;

-- 7. 授權執行與存取
grant usage on schema public to anon, authenticated;
grant execute on function public.get_seesaw_stats() to anon, authenticated;
grant execute on function public.cast_vote(text) to authenticated;
grant select on table public.votes to authenticated;
