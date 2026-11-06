// Shared session + org data, loaded once after login and refreshed after edits.
import { db, must } from './supabase.js';

export const state = {
  session: null,
  profile: null,   // the signed-in person's profile row (null until onboarded)
  org: null,
  people: [],      // every profile in the org (RLS limits to the caller's org)
  homes: [],
  routes: [],
  rates: [],
};

export const isManager = () => !!state.profile && ['manager', 'owner'].includes(state.profile.role);
export const isOwner = () => !!state.profile && state.profile.role === 'owner';

export async function loadContext() {
  const uid = state.session.user.id;
  const people = await must(db.from('profiles').select('*').order('full_name'));
  state.people = people;
  state.profile = people.find((p) => p.user_id === uid && p.active) || null;
  if (!state.profile) { state.org = null; state.homes = state.routes = state.rates = []; return false; }
  state.org = await must(db.from('orgs').select('*').eq('id', state.profile.org_id).single());
  await Promise.all([loadHomes(), loadRoutes(), loadRates()]);
  return true;
}
export async function loadHomes() {
  state.homes = await must(db.from('homes').select('*').order('name'));
}
export async function loadRoutes() {
  state.routes = await must(db.from('routes').select('*').order('a_label'));
}
export async function loadRates() {
  state.rates = await must(db.from('mileage_rates').select('*').order('effective_date'));
}
export async function loadPeople() {
  state.people = await must(db.from('profiles').select('*').order('full_name'));
}
