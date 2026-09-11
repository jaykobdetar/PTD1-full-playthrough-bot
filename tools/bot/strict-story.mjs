/** Read-only planning for earned native rewards. This module never creates a
 * Pokémon, trains a level, changes money, or writes a quest/completion flag. */
import { achievementStatus } from '../../src/achievements.js';

const forms = ['normal', 'shiny', 'shadow'];
const purpose = 'collection-strict-reward';
const birds = [
  { speciesId: 145, stage: 37, typeId: 11, type: 'Electric', firstFlag: 20 },
  { speciesId: 144, stage: 38, typeId: 12, type: 'Ice', firstFlag: 23 },
  { speciesId: 146, stage: 39, typeId: 4, type: 'Fire', firstFlag: 26 },
];
const known = save => new Set(forms.flatMap(form => save.dex?.[form] ?? []));
const formOf = team => team.every(p => p.shiny === 1) ? 1 : team.every(p => p.shiny === 2) ? 2 : 0;
const signature = team => team.map(p => `${p.uid}:${p.speciesId}:${p.level}:${p.shiny ?? 0}:${(p.moves ?? []).join(',')}`).sort().join('|');
function score(data, p) {
  const s = data.species[p.speciesId];
  const attack = Math.max(0, ...(p.moves ?? []).map(id => {
    const move = data.moves[id];
    return (move?.power ?? 0) * (s.stats?.[move?.physical ? 'attack' : 'specialAttack'] ?? 0);
  }));
  return p.level * 10000 + attack + (s.stats?.hp ?? 0) + (s.stats?.defense ?? 0) + (s.stats?.specialDefense ?? 0);
}
const ranked = (data, team) => [...team].sort((a, b) => score(data, b) - score(data, a) || String(a.uid).localeCompare(String(b.uid)));

/** Match the native six-member checks in waves-runtime method_415,
 * method_335, and method_390, including exact level and form-specific flags.
 * Duplicates are allowed by the game, but every entry must be a distinct UID. */
export function strictRewardEligibility(game, save) {
  const data = game.data ?? game, owned = known(save), extras = save.originalExtraInfo ?? [];
  const unique = [...new Map((save.pokemon ?? []).map(p => [p.uid, p])).values()];
  const dojoTeam = ranked(data, unique.filter(p => p.level <= 70)).slice(0, 6);
  const dojoSpecies = extras.includes(30) ? 106 : 107;
  const dojoStatus = achievementStatus(save, 6);
  const dojo = {
    speciesId: dojoSpecies, stage: 26, missing: !owned.has(dojoSpecies),
    unlocked: (save.completed ?? []).includes(26),
    earned: dojoStatus.earned, claimable: (save.challengeCompleted ?? 0) >= 3 && dojoStatus.earned && !dojoStatus.claimed,
    requiredUids: dojoTeam.map(p => p.uid), team: dojoTeam,
    eligible: (save.completed ?? []).includes(26) && dojoTeam.length > 0,
    reason: dojoTeam.length ? 'All selected attackers are at level 70 or below; candy four must be stolen first during the battle' : 'No owned attacker is at level 70 or below',
  };
  const legendary = birds.map(route => {
    const typed = ranked(data, unique.filter(p => p.myTag !== 'h' && data.species[p.speciesId]?.typeIds?.includes(route.typeId)));
    const ready = typed.filter(p => p.level === 100);
    // Usually the strongest six suffice. When a form reward is already
    // claimed, also consider the other form groups and a legal mixed party.
    const groups = [ready.slice(0, 6), ...[0, 1, 2].map(form => ready.filter(p => (p.shiny ?? 0) === form).slice(0, 6))];
    if (ready.length >= 6) {
      for (const first of ready) {
        const other = ready.find(p => (p.shiny ?? 0) !== (first.shiny ?? 0));
        if (other) groups.push([first, other, ...ready.filter(p => p !== first && p !== other).slice(0, 4)]);
      }
    }
    const team = groups.find(group => group.length === 6 && !extras.includes(route.firstFlag + formOf(group))) ?? [];
    const unlocked = (save.completed ?? []).includes(route.stage);
    return {
      ...route, missing: !owned.has(route.speciesId), unlocked,
      eligible: unlocked && team.length === 6, requiredUids: team.map(p => p.uid), team,
      rewardForm: team.length ? forms[formOf(team)] : null,
      compatibleOwned: typed.length, level100Owned: ready.length,
      trainingCandidates: typed.filter(p => p.level < 100).slice(0, Math.max(0, 6 - ready.length)).map(p => ({ uid: p.uid, speciesId: p.speciesId, level: p.level, targetLevel: 100 })),
      reason: !unlocked ? 'Complete this story stage first' : ready.length < 6 ? `Need six actually owned level-100 ${route.type} Pokémon; currently ${ready.length}` : !team.length ? 'All available party-form rewards have already been claimed' : 'Native party prerequisite is satisfied; defeat the quest boss and win the stage',
    };
  });
  return { dojo, birds: legendary };
}

function retryAvailable(attempts, stage, team) {
  const same = attempts.filter(a => a.purpose === purpose && (a.campaignId === stage || a.stage === `level_${stage}`)
    && (!team?.length || !a.party || signature(a.party) === signature(team)));
  return same.length < 4;
}
function plan(game, stage, target, reason, options = {}) {
  const level = game.levels.find(level => level.id === stage);
  if (!level) return null;
  return { kind: 'story', stageId: stage, level, campaignId: stage, purpose, targetSpecies: [target],
    partyOptions: { paidMoves: false }, policyOptions: { capture: 'none', training: false, relearn: false, paidHealing: false },
    reason, ...options,
  };
}

/** Return an actual replayable visit, or null when claims/preparation are
 * needed. The caller claims earned achievements through claimAchievement().
 * A win is never treated as proof that its conditional reward was obtained. */
export function nextStrictReward(game, save, attempts = []) {
  const status = strictRewardEligibility(game, save), owned = known(save);
  const dojo = status.dojo;
  if (dojo.missing && !dojo.earned && dojo.eligible && retryAvailable(attempts, 26, dojo.team)) {
    return plan(game, 26, dojo.speciesId, 'Earn Dojo achievement 6 with attackers at most level 70 and candy four stolen first; claim the earned reward after Challenge 3', {
      partyOptions: { requiredUids: dojo.requiredUids, maxLevel: 70, paidMoves: false },
      policyOptions: { capture: 'none', training: false, relearn: false, paidHealing: false, preferredCandyId: 3 },
    });
  }
  // Reserve the perfect-defense attempts until the rare captures have supplied
  // the strongest earned defenders. Failed early visits must not exhaust this route.
  if (!owned.has(142) && owned.has(150) && owned.has(151)) {
    // Choose the strongest owned member of each role, including unevolved
    // Kadabra. A dex entry alone does not mean its evolved member is trained.
    const role = (ids, fallback) => ranked(game.data, save.pokemon.filter(p => ids.includes(p.speciesId)))[0]?.speciesId ?? fallback;
    const preferredSpecies = [150,role([64,65],65),151,role([87,131],131),76,26];
    const team = preferredSpecies.map(id => ranked(game.data, save.pokemon.filter(p => p.speciesId === id))[0]).filter(Boolean);
    for (const [stage, flag] of [[32, 29], [33, 34]]) {
      if ((save.completed ?? []).includes(stage) && !(save.originalExtraInfo ?? []).includes(flag) && retryAvailable(attempts, stage, team))
        return plan(game, stage, 142, 'Retain every candy with the earned late-game defenders, win, and accept the native Aerodactyl reward', {
          partyOptions:{preferredSpecies,paidMoves:true},
          policyOptions:{capture:'all',training:false,relearn:true,paidHealing:true,repositionEvery:6,defendAllCandy:true},
        });
    }
  }
  for (const bird of status.birds) if (bird.missing && bird.eligible && retryAvailable(attempts, bird.stage, bird.team)) {
    return plan(game, bird.stage, bird.speciesId, `${bird.reason}; preserve this six-member ${bird.type} party throughout the visit`, {
      partyOptions: { requiredUids: bird.requiredUids, paidMoves: bird.stage===39, ...(bird.stage===39?{extraMoves:[143,114]}:{}) },
      ...(bird.stage===39?{policyOptions:{capture:'none',training:false,relearn:true,paidHealing:true}}:{}),
    });
  }
  return null;
}
