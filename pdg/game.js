const playerCountSelect = document.getElementById('player-count');
const playerEntries = document.getElementById('player-entries');
const startButton = document.getElementById('start-game');
const rollButton = document.getElementById('roll-button');
const nextTurnButton = document.getElementById('next-turn-button');
const resetButton = document.getElementById('reset-button');
const gameState = document.getElementById('game-state');
const currentPlayerName = document.getElementById('current-player-name');
const currentPlayerStarter = document.getElementById('current-player-starter');
const currentPlayerPosition = document.getElementById('current-player-position');
const currentSpaceName = document.getElementById('current-space-name');
const currentGreyRule = document.getElementById('current-grey-rule');
const currentPlayerCard = document.getElementById('current-player-card');
const spaceDescription = document.getElementById('space-description');
const boardOverlay = document.getElementById('board-overlay');
const gameLog = document.getElementById('game-log');
const rollResult = document.getElementById('roll-result');

let players = [];
let currentPlayerIndex = 0;
let gameStarted = false;
let boardPositions = [];
let gameLogEntries = []; // newest-first list of log strings (mirrors DOM order)

// Single canonical game state object. Exposed via getters/setters so the
// existing top-level `let` variables keep working unchanged, while still
// giving us one place to (de)serialize for network sync in later phases.
const state = {
  get players() { return players; },
  set players(v) { players = v; },
  get currentPlayerIndex() { return currentPlayerIndex; },
  set currentPlayerIndex(v) { currentPlayerIndex = v; },
  get gameStarted() { return gameStarted; },
  set gameStarted(v) { gameStarted = v; },
  get log() { return gameLogEntries; },
  set log(v) { gameLogEntries = Array.isArray(v) ? v : []; }
};

// Serialize the parts of the state that should travel over the wire.
function serializeState() {
  return {
    players: JSON.parse(JSON.stringify(players)),
    currentPlayerIndex,
    gameStarted,
    log: gameLogEntries.slice()
  };
}

// Replace local state with a snapshot from the server.
// Does not re-render on its own; callers should call render() afterwards.
function loadState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (Array.isArray(snapshot.players)) players = snapshot.players;
  if (Number.isInteger(snapshot.currentPlayerIndex)) currentPlayerIndex = snapshot.currentPlayerIndex;
  if (typeof snapshot.gameStarted === 'boolean') gameStarted = snapshot.gameStarted;
  if (Array.isArray(snapshot.log)) gameLogEntries = snapshot.log.slice();
}

// Single entry point to redraw the world from state. Safe to call any time.
function render() {
  renderLog();
  refreshBoardTokens();
  updateStatus();
}

function renderLog() {
  if (!gameLog) return;
  gameLog.innerHTML = '';
  gameLogEntries.forEach((message) => {
    const line = document.createElement('div');
    line.textContent = message;
    gameLog.append(line); // entries are newest-first, so append in order
  });
}

const starterOptions = ['Charmander', 'Squirtle', 'Bulbasaur'];
const specialSpaceMap = new Map();

const pokemonEvolutions = {
  'Charmander': 'Charmeleon',
  'Squirtle': 'Wartortle',
  'Bulbasaur': 'Ivysaur',
  'Pikachu': 'Raichu'
};

const greySections = [
  { start: 23, end: 27, rule: 'No talking while in the Pokemon Tower. If you talk, take a drink.' },
  { start: 36, end: 40, rule: 'While infiltrating Team Rocket HQ, take 2 drinks to calm your nerves before each turn.' },
  { start: 48, end: 51, rule: 'Before each turn in the Safari Zone, roll a die. 1-2: You throw bait. Give 1 drink to someone. 3-4: You throw a rock, dick. Lose your turn, drink 4. 5-6: You throw a safari ball. Drink 2 in sadness, because safari balls are just awful.' }
];

const battleAdvantage = {
  'Squirtle|Charmander': 2,
  'Charmander|Bulbasaur': 2,
  'Bulbasaur|Squirtle': 2,
  'Pikachu|Squirtle': 2
};

function createPlayerRows(count) {
  playerEntries.innerHTML = '';

  for (let i = 0; i < count; i += 1) {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <h3>Player ${i + 1}</h3>
      <label>
        Name
        <input type="text" value="Player ${i + 1}" data-player-name="${i}" />
      </label>
      <label>
        Starter Pokémon
        <select data-player-starter="${i}">
          ${starterOptions.map((starter) => `<option value="${starter}">${starter}</option>`).join('')}
        </select>
      </label>
    `;

    playerEntries.append(row);
  }
}

function setUpBoardPositions() {
  const positions = [];
  const centers = Array.from({ length: 9 }, (_, i) => 15 + i * 8.75);

  // Outer ring: left column (bottom to top), top row, right column, bottom row
  centers.slice().reverse().forEach((y) => {
    positions.push({ index: positions.length, x: centers[0], y });
  });

  centers.slice(1).forEach((x) => {
    positions.push({ index: positions.length, x, y: centers[0] });
  });

  centers.slice(1).forEach((y) => {
    positions.push({ index: positions.length, x: centers[8], y });
  });

  centers.slice(1, -1).reverse().forEach((x) => {
    positions.push({ index: positions.length, x, y: centers[8] });
  });

  // Second ring
  centers.slice(1, 8).reverse().forEach((y) => {
    positions.push({ index: positions.length, x: centers[1], y });
  });

  centers.slice(2, 8).forEach((x) => {
    positions.push({ index: positions.length, x, y: centers[1] });
  });

  centers.slice(2, 8).forEach((y) => {
    positions.push({ index: positions.length, x: centers[7], y });
  });

  centers.slice(2, 7).reverse().forEach((x) => {
    positions.push({ index: positions.length, x, y: centers[7] });
  });

  // Third ring
  centers.slice(2, 7).reverse().forEach((y) => {
    positions.push({ index: positions.length, x: centers[2], y });
  });

  centers.slice(3, 7).forEach((x) => {
    positions.push({ index: positions.length, x, y: centers[2] });
  });

  centers.slice(3, 7).forEach((y) => {
    positions.push({ index: positions.length, x: centers[6], y });
  });

  centers.slice(3, 6).reverse().forEach((x) => {
    positions.push({ index: positions.length, x, y: centers[6] });
  });

  boardPositions = positions;
}

function buildSpaces() {
  const cleanedDescriptions = [
    "Pallet Town:Pick one, dude.",
    "Rattata used Tackle!... wait, you seriously rolled a 1? You fainted. Finish your drink.",
    "Pidgey used Quick Attack! Use that quickness to give a drink and take an extra turn.",
    "Caterpie used String Shot! It was super effective! All other players may only move half of what they roll on their next turn (round up).",
    "You caught a Pikachu! Drink 2 and replace your starter with this walking electric franchise.",
    "Beedrill used Twinneedle! Pick two people to drink.",
    "Pewter Gym: Roll a die. Even: Give a drink. Odd: Take a drink.",
    "If you're a guy, guys drink 1. If you're a girl, girls drink 1.",
    "Zubats... they're... they're everywhere! Take a drink. Next turn, if you roll a 1 or 2, stay here and take a drink.",
    "Clefairy used Metronome! Close your eyes, point to a random square, and drink or give what it says. If no drink given or taken, just drink 2.",
    "Jigglypuff used Sing! Everyone else falls asleep! Take an extra turn.",
    "Abra used Teleport! Teleport to the other Abra.",
    "Roll a die. Drink half, give half (round up). What's that guy's deal anyway?",
    "Cerulean Gym: Misty's water attacks caused splash damage. You drink 2, Everyone else drinks 1.",
    "Slowpoke is slow. For the first one here, make up a gesture. For the rest of the game, when you do it, the last to mimic you takes a drink.",
    "Bellsprout used Razor Leaf! Shred someone's dignity with a reckless callout. They drink 1 in shame.",
    "Meowth used Pay Day! Everyone but you takes a drink.",
    "Diglett used Dig! Dig deep and finish your drink.",
    "Enjoy your cruise aboard the S.S. Anne! Roll a die, you lose that many turns aboard the luxury cruise liner. Roll again and drink that number during each lost turn.",
    "Vermilion Gym: Roll a die. Even, you're paralyzed, take 2 drinks and miss your next turn. Odd, take a drink.",
    "I want to ride my BICYCLE! BICYCLE! BICYCLE! On your next turn, roll the die and move twice that number.",
    "Magikarp used Splash!... But nothing happened.",
    "Sandschrew used Sand Attack! Your accuracy is lowered. For the rest of the game, you may only drink with your non-dominant hand.",
    "Pokemon Tower. While in the Pokemon Tower, out of respect for the dead, you should not speak. Doing so results in 2 drinks each time. Take a drink now for your fallen comrades.",
    "A possessed Channeler. Now you're possessed too! While you are on this space, anyone may make you get them a drink.",
    "Haunter used Dream Eater! Devour someone else's dreams by moving them back 10 spaces.",
    "Cubone used \"My mother is dead.\" Share a depressing story with the group. Then everyone take a drink.",
    "If someone is in Silph Co., you use the Silph Scope to beat the ghost and everyone else drinks. Otherwise take 3 drinks to appease the dead.",
    "Abra used Teleport! Teleport to the other Abra.",
    "A sleeping Snorlax blocks your path. Belt out a song of the group's choice to wake him, or take 4 drinks.",
    "Roll a die. Drink that number minus one. Seriously though, is this dude following you or something?",
    "Evolution time! You choose a new rule! Any rule violations result in a drink.",
    "Celadon Gym: Roll a die. 1-3: Stun Spore, lose a turn. 4-6: Mega Drain, finish your drink.",
    "Psyduck is slow. For the first one here, make up a gesture. For the rest of the game, when you do it, the last one to do it takes a drink.",
    "What? Your Pokemon is evolving! Let it evolve: Drink 4 and skip the next gym. Stop evolution: Take an extra turn.",
    "Porygon used Tri Attack! While on this space, for each drink you are given, the giver must drink 3.",
    "Silph Co. You've infiltrated the headquarters of the infamous Team Rocket! You will need all your courage to make it to their leader. Drink an extra drink every turn to calm your nerves.",
    "A Scientist uses his magnet Pokemon. You magnetically attract 1 drink per player in the game.",
    "Lapras used Confuse Ray! Pick a player, they are now confused. Next turn, they must roll a 1-3 to stop being confused. If not, they are still confused, and lose a turn.",
    "It's Team Rocket! Watch them defeat themselves with incompetence, and everyone drink to them blasting off.",
    "Giovanni. Roll a die. 1-3: Give that number. 4-6: Drink that number.",
    "Rare Candy - Level up! You get an extra turn.",
    "Roll a die and take that many drinks. The next time this punk hassles you will be the last.",
    "Saffron Gym: Use psychic powers to pick a number, then roll the die. If it's your number, take an extra turn. If not, drink 2.",
    "Challenge someone to a chugging contest. First to finish gets an extra turn, last to finish loses a turn.",
    "Krabby used Crabhammer! Bring down the Crabhammer on someone; they must finish their drink.",
    "Ditto used Transform! During the next person's turn, you must copy everything they do!",
    "Doduo used Double-Edge! You give 4 drinks, but you drink 1.",
    "Safari Zone. Before each turn in the Safari Zone, roll a die. 1-2: You throw bait. Give 1 drink to someone. 3-4: You throw a rock, dick. Lose your turn, drink 4. 5-6: You throw a safari ball. Drink 2 in sadness, because safari balls are just awful.",
    "Gone fishin'... A wild Dratini appeared! Roll a 1 to catch it. Otherwise, drink 1.",
    "A wild Taurus appeared... but instantly fled. Drink 2 for not being quick enough.",
    "Roll the die. If it's 1-3 Chansey eludes you, drink 1. If 4-6, you capture Chansey, give 2.",
    "Fuchsia Gym: Poison Pokemon are toxic! Better get intoxicated! Drink 3.",
    "Electrode used Explosion! Everybody finishes their drinks.",
    "Electabuzz used Thunder Punch! You're paralyzed, miss your next turn.",
    "Poliwag used Hydro Pump! Shotgun a beer.",
    "Seaking used Waterfall!... do a waterfall!",
    "A wild Missingno! Roll 3 times. Get a 5 or 6, and you continue. If not, you glitched. Restart at Pallet Town.",
    "Cinnabar Gym: Roll a die. Even, roll again. Odd, drink twice as many times as you rolled evens.",
    "Koffing used Haze! If there's anything nearby to smoke, smoke it to avoid taking 2 drinks.",
    "You resurrected a Fossil Pokemon. Everyone older than you drinks 2.",
    "You throw a Pokeball! If your favorite Pokemon is on the board, roll a 1-3 to catch it. Roll a 4-6 and it got away, drink 3. If your favorite is not on the board, sadly drink 3.",
    "Persian used Fury Swipes! Roll a die, and give out that many drinks.",
    "Viridian Gym: First, take a drink. Then, if you're a guy, guys take 3. If you're a girl, girls take 3.",
    "Fearow user Mirror Move! Drink what the last person did during his/her last turn.",
    "Graveler used Defense Curl! Lose 2 turns, but you do not have to take any drinks until you go again.",
    "Gyarados used Dragon Rage! Take 4 drinks unless you landed on Magikarp, in which case you give 4 drinks.",
    "Dragonite used Hyper Beam! Give 5 drinks, but lose a turn to recharge.",
    "Gotta catch 'em all! Roll a die. 1-3: Why are you throwing Great Balls at it? Take a drink! 4-6: You got one! You may only move on once you've caught all 3 birds.",
    "The Elite Four: Challenge the land's greatest trainers: the Elite Four! Roll a 4 to defeat the Elite Four! For any other number, drink 4.",
    "Champion Gary: Finish a full drink to take down this bastard for the last time! You cannot move until your drink is finished.",
    "Throw that Master Ball and take a victory drink. All other players toast to your glory! You are a Pokemon Master!"
  ];

  const spaces = Array.from({ length: 72 }, (_, index) => ({
    index,
    name: `Space ${index}`,
    description: cleanedDescriptions[index] || 'Move forward along the path. If you land on a special tile, follow its rule.',
    color: 'white'
  }));

  spaces[0] = {
    ...spaces[0],
    name: 'Pallet Town',
    description: cleanedDescriptions[0],
    color: 'start'
  };

  const yellowSpaces = [6, 13, 19, 32, 43, 52, 58, 63, 68, 69, 70, 71];

  yellowSpaces.forEach((index) => {
    spaces[index].color = 'yellow';
    spaces[index].name = `Yellow space ${index}`;
  });

  const customSpace = {
    19: { name: 'Pewter Gym' },
    32: { name: 'Cerulean Gym' },
    43: { name: 'Viridian Gym' },
    52: { name: 'Vermilion Gym' }
  };

  Object.entries(customSpace).forEach(([index, data]) => {
    spaces[index] = { ...spaces[index], ...data, color: 'yellow' };
  });

  greySections.forEach(({ start, end, rule }) => {
    for (let i = start; i <= end; i += 1) {
      spaces[i].color = 'grey';
      spaces[i].name = `Grey Area ${i}`;
    }
  });

  return spaces;
}

const spaces = buildSpaces();

function renderBoardOverlay() {
  boardOverlay.innerHTML = '';

  spaces.forEach((space) => {
    const marker = document.createElement('div');
    marker.className = `space-dot ${space.color}`;
    marker.style.left = `${boardPositions[space.index].x}%`;
    marker.style.top = `${boardPositions[space.index].y}%`;
    marker.title = `${space.name} (${space.color})\n${space.description}`;

    boardOverlay.append(marker);
  });
}

function addTokenMarker(player) {
  const token = document.createElement('div');
  token.className = `player-token p${player.id}`;
  token.dataset.playerId = player.id;
  token.style.left = `${boardPositions[player.position].x}%`;
  token.style.top = `${boardPositions[player.position].y}%`;
  
  // Calculate offset for multiple tokens at same position
  const playersAtPosition = players.filter(p => p.position === player.position);
  const playerIndex = playersAtPosition.findIndex(p => p.id === player.id);
  const totalPlayers = playersAtPosition.length;
  
  if (totalPlayers > 1) {
    // Arrange tokens in a circle around the position
    const angle = (playerIndex / totalPlayers) * Math.PI * 2;
    const radius = 15; // pixels offset
    const offsetX = Math.cos(angle) * radius;
    const offsetY = Math.sin(angle) * radius;
    token.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }
  
  token.textContent = player.initial;
  boardOverlay.append(token);
}

function refreshBoardTokens() {
  document.querySelectorAll('.player-token').forEach((node) => node.remove());
  players.forEach(addTokenMarker);
}

function showPlayerChoice() {
  const choiceDiv = document.getElementById('player-choice');
  choiceDiv.innerHTML = '<p>Choose a player to send back 10 spaces:</p>';
  players.forEach(p => {
    if (p.id !== players[currentPlayerIndex].id) {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        p.position = Math.max(0, p.position - 10);
        logLine(`${p.name} was sent back 10 spaces to position ${p.position}.`);
        refreshBoardTokens();
        updateStatus();
        players[currentPlayerIndex].awaitingPlayerChoice = false;
        players[currentPlayerIndex].choiceSpace = null;
        choiceDiv.classList.add('hidden');
        rollButton.disabled = true;
        nextTurnButton.disabled = false;
      });
      choiceDiv.appendChild(btn);
    }
  });
  choiceDiv.classList.remove('hidden');
}

function showNumberPickChoice() {
  const choiceDiv = document.getElementById('player-choice');
  choiceDiv.innerHTML = '<p>Pick a number 1-6:</p>';
  
  for (let i = 1; i <= 6; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      players[currentPlayerIndex].pickedNumber = i;
      players[currentPlayerIndex].awaitingNumberPick = false;
      logLine(`${players[currentPlayerIndex].name} picked the number ${i}.`);
      rollResult.textContent = `${players[currentPlayerIndex].name} picked ${i}. Click Roll to continue.`;
      choiceDiv.classList.add('hidden');
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
    });
    choiceDiv.appendChild(btn);
  }
  
  choiceDiv.classList.remove('hidden');
}

function showConfusionChoice() {
  const choiceDiv = document.getElementById('player-choice');
  choiceDiv.innerHTML = '<p>Choose a player to confuse:</p>';
  players.forEach(p => {
    if (p.id !== players[currentPlayerIndex].id) {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        p.confused = true;
        p.confusedBy = players[currentPlayerIndex].name;
        logLine(`${p.name} is now confused by ${players[currentPlayerIndex].name}!`);
        rollResult.textContent = `${p.name} is now confused!`;
        players[currentPlayerIndex].awaitingConfusionChoice = false;
        choiceDiv.classList.add('hidden');
        rollButton.disabled = true;
        nextTurnButton.disabled = false;
      });
      choiceDiv.appendChild(btn);
    }
  });
  choiceDiv.classList.remove('hidden');
}

function showChuggingChoice() {
  const choiceDiv = document.getElementById('player-choice');
  choiceDiv.innerHTML = '<p>Challenge someone to a chugging contest:</p>';
  players.forEach(p => {
    if (p.id !== players[currentPlayerIndex].id) {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        players[currentPlayerIndex].chuggingOpponent = p.id;
        players[currentPlayerIndex].awaitingChuggingChoice = false;
        players[currentPlayerIndex].awaitingChuggingResult = true;
        choiceDiv.classList.add('hidden');
        showChuggingResult();
      });
      choiceDiv.appendChild(btn);
    }
  });
  choiceDiv.classList.remove('hidden');
}

function showChuggingResult() {
  const choiceDiv = document.getElementById('player-choice');
  const player = players[currentPlayerIndex];
  const opponent = players.find(p => p.id === player.chuggingOpponent);
  choiceDiv.innerHTML = `<p>Did ${opponent.name} win the chugging contest?</p>`;
  
  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'Yes';
  yesBtn.addEventListener('click', () => {
    opponent.extraTurn = true;
    logLine(`${opponent.name} won the chugging contest and gets an extra turn!`);
    rollResult.textContent = `${opponent.name} wins! They get an extra turn.`;
    player.awaitingChuggingResult = false;
    player.chuggingOpponent = null;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
  });
  choiceDiv.appendChild(yesBtn);
  
  const noBtn = document.createElement('button');
  noBtn.textContent = 'No';
  noBtn.addEventListener('click', () => {
    player.extraTurn = true;
    logLine(`${player.name} won the chugging contest and gets an extra turn!`);
    rollResult.textContent = `${player.name} wins! You get an extra turn.`;
    player.awaitingChuggingResult = false;
    player.chuggingOpponent = null;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
  });
  choiceDiv.appendChild(noBtn);
  
  choiceDiv.classList.remove('hidden');
}

function showNumberPickChoice() {
  const choiceDiv = document.getElementById('player-choice');
  choiceDiv.innerHTML = '<p>Pick a number 1-6:</p>';
  
  for (let i = 1; i <= 6; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      players[currentPlayerIndex].pickedNumber = i;
      players[currentPlayerIndex].awaitingNumberPick = false;
      logLine(`${players[currentPlayerIndex].name} picked the number ${i}.`);
      rollResult.textContent = `${players[currentPlayerIndex].name} picked ${i}. Click Roll to continue.`;
      choiceDiv.classList.add('hidden');
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
    });
    choiceDiv.appendChild(btn);
  }
  
  choiceDiv.classList.remove('hidden');
}

function showFavoritePokemonChoice() {
  const choiceDiv = document.getElementById('player-choice');
  const player = players[currentPlayerIndex];
  choiceDiv.innerHTML = '<p>Is your favorite pokemon on the board?</p>';
  
  // Yes button
  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'Yes';
  yesBtn.addEventListener('click', () => {
    player.favoritePokemonOnBoard = true;
    player.awaitingFavoritePokemonChoice = false;
    logLine(`${player.name} said yes. They will now roll to catch their favorite pokemon.`);
    rollResult.textContent = `${player.name}, click Roll to attempt catching your favorite pokemon with a Pokeball.`;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
  });
  choiceDiv.appendChild(yesBtn);
  
  // No button
  const noBtn = document.createElement('button');
  noBtn.textContent = 'No';
  noBtn.addEventListener('click', () => {
    player.favoritePokemonOnBoard = false;
    player.awaitingFavoritePokemonChoice = false;
    logLine(`${player.name} said no. They take 3 drinks.`);
    rollResult.textContent = `${player.name}, your favorite pokemon isn't on the board. Take 3 drinks.`;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
  });
  choiceDiv.appendChild(noBtn);
  
  choiceDiv.classList.remove('hidden');
}

function showDrinkQuestion() {
  const choiceDiv = document.getElementById('player-choice');
  const player = players[currentPlayerIndex];
  choiceDiv.innerHTML = '<p>Have you finished a full drink?</p>';
  
  // Yes button
  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'Yes';
  yesBtn.addEventListener('click', () => {
    player.awaitingDrinkQuestion = false;
    player.championGaryCleared = true;
    player.extraTurn = true;
    logLine(`${player.name} said yes! They get to become a Pokemon Master!`);
    rollResult.textContent = `${player.name} gets to become a Pokemon Master!`;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
  });
  choiceDiv.appendChild(yesBtn);
  
  // No button
  const noBtn = document.createElement('button');
  noBtn.textContent = 'No';
  noBtn.addEventListener('click', () => {
    player.awaitingDrinkQuestion = false;
    logLine(`${player.name} said no. They stay here until they finish a full drink.`);
    rollResult.textContent = `${player.name} stays here until they finish a full drink.`;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
  });
  choiceDiv.appendChild(noBtn);
  
  choiceDiv.classList.remove('hidden');
}

function showEvolutionChoice() {
  const choiceDiv = document.getElementById('player-choice');
  const player = players[currentPlayerIndex];
  const evolution = pokemonEvolutions[player.starter];
  
  if (!evolution) {
    logLine(`${player.name}'s ${player.starter} cannot evolve!`);
    rollResult.textContent = `${player.name}'s ${player.starter} cannot evolve!`;
    player.awaitingEvolution = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }
  
  choiceDiv.innerHTML = `<p>Evolve ${player.starter} to ${evolution}?</p>`;
  
  // Evolve button
  const evolveBtn = document.createElement('button');
  evolveBtn.textContent = 'Evolve';
  evolveBtn.addEventListener('click', () => {
    player.starter = evolution;
    player.justEvolved = true;
    logLine(`${player.name}'s pokemon evolved to ${evolution}!`);
    rollResult.textContent = `${player.name}'s pokemon evolved to ${evolution}!`;
    updateStatus();
    player.awaitingEvolution = false;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
  });
  choiceDiv.appendChild(evolveBtn);
  
  // Extra turn button
  const extraTurnBtn = document.createElement('button');
  extraTurnBtn.textContent = 'Skip Evolution (Extra Turn)';
  extraTurnBtn.addEventListener('click', () => {
    player.extraTurn = true;
    logLine(`${player.name} chose not to evolve and gets an extra turn!`);
    rollResult.textContent = `${player.name} gets an extra turn!`;
    player.awaitingEvolution = false;
    choiceDiv.classList.add('hidden');
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
  });
  choiceDiv.appendChild(extraTurnBtn);
  
  choiceDiv.classList.remove('hidden');
}

function logLine(message) {
  gameLogEntries.unshift(message); // newest first
  const line = document.createElement('div');
  line.textContent = message;
  gameLog.prepend(line);
  schedulePushState();
}

function updateStatus() {
  if (!gameStarted) {
    gameState.textContent = 'Set up the game to begin.';
    currentPlayerCard.classList.add('hidden');
    spaceDescription.classList.add('hidden');
    return;
  }

  const player = players[currentPlayerIndex];
  const space = spaces[player.position];

  gameState.textContent = `${player.name}'s turn.`;
  currentPlayerCard.classList.remove('hidden');
  currentPlayerName.textContent = player.name;
  currentPlayerStarter.textContent = player.starter;
  if (player.activeGreyRule) {
    currentGreyRule.textContent = player.activeGreyRule;
    currentGreyRule.parentElement.style.display = '';
  } else {
    currentGreyRule.textContent = 'None';
    currentGreyRule.parentElement.style.display = 'none';
  }
  spaceDescription.textContent = space.description;
  spaceDescription.classList.remove('hidden');
}

function getDiceRoll() {
  // When networked, this drains from a queue of server-rolled dice fetched
  // at the start of the current turn-action (see prefetchDiceIfOnline).
  if (dicePrefetched.length > 0) return dicePrefetched.shift();
  return Math.floor(Math.random() * 6) + 1;
}

// ─── Networking integration (Path B "thin client") ───
// All globals live in `state` (declared at top). When connected to a room,
// the current player's browser fetches dice from the server and pushes a
// fresh state snapshot after every action; other clients apply incoming
// snapshots via loadState() + render().
let dicePrefetched = [];
let applyingRemoteSnapshot = false;
let pendingPush = false;

function isOnline() { return Boolean(window.net && window.net.online); }
function myTurnOnline() {
  if (!isOnline()) return true;
  const idx = window.net.myIndex();
  return idx === -1 || idx === currentPlayerIndex;
}

async function prefetchDiceIfOnline(count = 16) {
  dicePrefetched = [];
  if (!isOnline()) return;
  try {
    dicePrefetched = await window.net.fetchDice(count);
  } catch (err) {
    console.error('dice fetch failed; falling back to local', err);
    dicePrefetched = [];
  }
}

function schedulePushState() {
  if (!isOnline()) return;
  if (applyingRemoteSnapshot) return;
  if (!myTurnOnline()) return;
  if (pendingPush) return;
  pendingPush = true;
  Promise.resolve().then(() => {
    pendingPush = false;
    if (!isOnline()) return;
    window.net.pushState(serializeState()).catch((err) => console.error('push state failed', err));
  });
}

function applyRemoteSnapshot(snapshot) {
  applyingRemoteSnapshot = true;
  try {
    loadState(snapshot);
    if (gameStarted) {
      const setup = document.querySelector('.game-setup');
      if (setup) setup.style.display = 'none';
      renderBoardOverlay();
    }
    render();
    // Spectators have no controls
    if (!myTurnOnline()) {
      rollButton.disabled = true;
      nextTurnButton.disabled = true;
      rollResult.textContent = `Waiting for ${players[currentPlayerIndex]?.name || 'other player'}…`;
    } else {
      rollResult.textContent = '';
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
    }
  } finally {
    applyingRemoteSnapshot = false;
  }
}

function getBattleRolls(starter, opponentStarter) {
  const key = `${starter}|${opponentStarter}`;
  const opponentKey = `${opponentStarter}|${starter}`;
  let myRolls = 1;
  let opponentRolls = 1;

  if (battleAdvantage[key] === 2) {
    myRolls = 2;
  }

  if (battleAdvantage[opponentKey] === 2) {
    opponentRolls = 2;
  }

  const rolls = (count) => Array.from({ length: count }, () => getDiceRoll());
  return {
    myBest: Math.max(...rolls(myRolls)),
    opponentBest: Math.max(...rolls(opponentRolls)),
    myRolls,
    opponentRolls
  };
}

function findGreySection(position) {
  return greySections.find(({ start, end }) => position >= start && position <= end);
}

async function showDiceAnimation(rollValue) {
  const diceRoller = document.getElementById('dice-roller');
  const diceNumber = diceRoller.querySelector('.dice-number');
  
  diceRoller.classList.remove('hidden');
  
  // Flash through random numbers during animation
  const flashInterval = setInterval(() => {
    diceNumber.textContent = Math.floor(Math.random() * 6) + 1;
  }, 80);
  
  // Wait for animation to complete (0.6s)
  await new Promise(resolve => setTimeout(resolve, 600));
  
  // Stop flashing and show the final number
  clearInterval(flashInterval);
  diceNumber.textContent = rollValue;
  
  // Keep visible for a bit longer
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  diceRoller.classList.add('hidden');
}

async function movePlayer(player, rolls, landingRoll = rolls) {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Zoom helpers
  const boardContainer = document.getElementById('board-container');
  const getToken = () => document.querySelector(`.player-token.p${player.id}`);
  function zoomToToken() {
    const token = getToken();
    if (!token) return;
    const boardRect = boardContainer.getBoundingClientRect();
    const tokenRect = token.getBoundingClientRect();
    // Calculate center offset
    const scale = 2;
    const boardCenterX = boardRect.left + boardRect.width / 2;
    const boardCenterY = boardRect.top + boardRect.height / 2;
    const tokenCenterX = tokenRect.left + tokenRect.width / 2;
    const tokenCenterY = tokenRect.top + tokenRect.height / 2;
    const offsetX = (boardCenterX - tokenCenterX) / scale;
    const offsetY = (boardCenterY - tokenCenterY) / scale;
    boardContainer.style.transition = 'transform 0.4s cubic-bezier(0.4,0,0.2,1)';
    boardContainer.style.transform = `scale(${scale}) translate(${offsetX}px, ${offsetY}px)`;
  }
  function zoomOut() {
    boardContainer.style.transition = 'transform 0.4s cubic-bezier(0.4,0,0.2,1)';
    boardContainer.style.transform = '';
  }

  // Start zoom
  await sleep(10); // allow DOM to update
  zoomToToken();

  let effectiveRolls = rolls;
  if (player.nextTurnHalved) {
    effectiveRolls = Math.ceil(rolls / 2);
    player.nextTurnHalved = false;
  }

  let steps = effectiveRolls;
  let newPosition = player.position;
  let stoppedEarly = false;

  while (steps > 0) {
    newPosition = (newPosition + 1) % spaces.length;
    steps -= 1;

    player.position = newPosition;
    refreshBoardTokens();
    updateStatus();
    zoomToToken();
    await sleep(500);

    if (spaces[newPosition].color === 'yellow') {
      // Allow evolved pokemon to pass through Saffron Gym (space 43)
      if (newPosition === 43 && player.justEvolved) {
        continue;
      }
      stoppedEarly = true;
      logLine(`${player.name} landed on yellow space ${newPosition} and stopped immediately.`);
      break;
    }
  }

  // After animation, ensure player.position is correct
  player.position = newPosition;
  const landedSpace = spaces[newPosition];

  // Zoom out after movement
  setTimeout(zoomOut, 400);

  // Handle teleportation
  if (newPosition === 11) {
    player.position = 28;
    logLine(`${player.name} landed on Abra and was teleported to the other Abra!`);
    refreshBoardTokens();
  } else if (newPosition === 28) {
    player.position = 11;
    logLine(`${player.name} landed on Abra and was teleported to the other Abra!`);
    refreshBoardTokens();
  }

  // Update landedSpace after potential teleport
  const finalLandedSpace = spaces[player.position];

  // Space 2: Pidgey Extra turn
  if (finalLandedSpace.index === 2) {
    player.extraTurn = true;
    logLine(`${player.name} landed on space 2 and will get an extra turn!`);
  }

  // Space 3: Halved movement for all other players next turn
  if (finalLandedSpace.index === 3) {
    players.forEach((p) => {
      if (p.id !== player.id) {
        p.nextTurnHalved = true;
      }
    });
    logLine(`${player.name} landed on space 3! All other players will have their next turn's movement halved (rounded up).`);
  }

  // Space 4: Replace starter with Pikachu
  if (finalLandedSpace.index === 4 && player.starter !== 'Pikachu') {
    player.starter = 'Pikachu';
    rollResult.textContent = `${player.name} landed on Pikachu and replaces their starter with Pikachu!`;
    logLine(`${player.name} landed on Pikachu and their starter has been replaced with Pikachu!`);
  }

  // Space 6: Pewter Gym Lucky roll (button-triggered)
  if (finalLandedSpace.index === 6) {
    player.awaitingLuckyRoll = true;
    player.luckyRollSpace = 6;
    rollResult.textContent = `${player.name} rolled a ${landingRoll}. Roll a die. Even: Give a drink. Odd: Take a drink.`;
    logLine(`${player.name} landed on Pewter Gym. Click the Roll Die button to proceed.`);
  }

  // Space 10: Jigglypuff Extra turn
  if (finalLandedSpace.index === 10) {
    player.extraTurn = true;
    rollResult.textContent = `${player.name} landed on Jigglypuff and gets an extra turn!`;
    logLine(`${player.name} landed on Jigglypuff and will get an extra turn!`);
  }

    // Space 12: Gary
  if (finalLandedSpace.index === 12) {
    player.awaitingLuckyRoll = true;
    player.luckyRollSpace = 12; 
    rollResult.textContent = `${player.name} rolled a ${landingRoll}. Roll a die. Drink half, give half (round up).`;
    logLine(`${player.name} landed on Gary. Click the Roll Die button to proceed.`);
  }

    // Space 18: S.S. Anne Miss turns and take drinks
  if (finalLandedSpace.index === 18) {
    player.awaitingSpace18Roll = true;
    logLine(`${player.name} landed on S.S. Anne!`);
    rollResult.textContent = `${player.name} rolled a ${landingRoll} and landed on S.S. Anne! Click the Roll Die button to see how many turns you will miss.`;
  }

  // Space 19: Vermilion Gym. Roll die to determine paralysis
  if (finalLandedSpace.index === 19) {
    player.awaitingSpace19Roll = true;
    logLine(`${player.name} landed on Vermilion Gym!`);
    rollResult.textContent = `${player.name} rolled a ${landingRoll} and landed on Vermilion Gym! Click the Roll Die button to proceed.`;
  }

  // Space 20: Next roll is doubled
  if (finalLandedSpace.index === 20) {
    player.nextTurnDoubled = true;
    logLine(`${player.name} landed on Bicycle Bicycle Bicycle. Their next roll will be doubled.`);
  }

  // Space 21: Magikarp landing
  if (finalLandedSpace.index === 21) {
    player.landedOn21 = true;
    logLine(`${player.name} landed on Magikarp!`);
  }
  // Space 25: Haunter - Choose player to send back 10 spaces
  if (finalLandedSpace.index === 25) {
    player.awaitingPlayerChoice = true;
    player.choiceSpace = 25;
    logLine(`${player.name} landed on Haunter. Choose another player to send back 10 spaces.`);
    rollResult.textContent = `${player.name} rolled a ${landingRoll} and landed on Haunter. Choose a player to send back 10 spaces.`;
    showPlayerChoice();
  }

  // Space 30: Roll die, take that many drinks minus 1
  if (finalLandedSpace.index === 30) {
    player.awaitingSpace30Roll = true;
    logLine(`${player.name} landed on Gary!`);
    rollResult.textContent = `${player.name} rolled a ${landingRoll} and landed on Gary! Click the Roll Die button to proceed.`;
  }

  // Space 32: Celadon Gym
  if (finalLandedSpace.index === 32) {
    player.awaitingTurn32Roll = true;
    logLine(`${player.name} landed on Celadon Gym! They must roll a die.`);
    rollResult.textContent = `${player.name} rolled a ${landingRoll} and landed on Celadon Gym! Click the Roll Die button to proceed.`;
  }

  // Space 34: Evolution choice
  if (finalLandedSpace.index === 34) {
    player.awaitingEvolution = true;
    logLine(`${player.name} Can choose to evolve their pokemon or get an extra turn.`);
    rollResult.textContent = `${player.name} Can choose to evolve their pokemon or get an extra turn.`;
    showEvolutionChoice();
  }

  // Space 38: Lapras - Choose player to confuse
  if (finalLandedSpace.index === 38) {
    player.awaitingConfusionChoice = true;
    logLine(`${player.name} landed on Lapras. Choose a player to confuse.`);
    rollResult.textContent = `${player.name} landed on Lapras. Choose a player to confuse.`;
    showConfusionChoice();
  }

  // Space 40: Giovanni - Roll die to determine drink/give
  if (finalLandedSpace.index === 40) {
    player.awaitingSpace40Roll = true;
    logLine(`${player.name} landed on Giovanni!`);
    rollResult.textContent = `${player.name} landed on Giovanni! Click the Roll Die button to proceed.`;
  }

  // Space 41: Rare Candy - Extra turn
  if (finalLandedSpace.index === 41) {
    player.extraTurn = true;
    logLine(`${player.name} landed on Rare Candy and gets an extra turn!`);
  }

  // Space 42: Roll for drinks before turn can end
  if (finalLandedSpace.index === 42) {
    player.awaitingSpace42DrinkRoll = true;
    logLine(`${player.name} landed on Gary and must roll to determine drinks.`);
    rollResult.textContent = `${player.name} rolled a ${landingRoll} and landed on Gary! Roll a die and drink that many.`;
  }

  // Space 43: Saffron Gym
  if (finalLandedSpace.index === 43) {
    if (player.justEvolved) {
      player.justEvolved = false;
      logLine(`${player.name}'s evolved pokemon helps them pass through Saffron Gym!`);
      rollResult.textContent = `${player.name} passes through Saffron Gym!`;
    } else {
      player.awaitingNumberPick = true;
      logLine(`${player.name} landed on Saffron Gym. Pick a number 1-6.`);
      rollResult.textContent = `${player.name} landed on Saffron Gym. Pick a number 1-6.`;
      showNumberPickChoice();
    }
  }

  // Space 44: Chugging contest - Choose opponent and determine winner
  if (finalLandedSpace.index === 44) {
    player.awaitingChuggingChoice = true;
    logLine(`${player.name} landed on the Chugging Contest. Choose an opponent.`);
    rollResult.textContent = `${player.name} landed on the Chugging Contest! Choose a player to challenge.`;
    showChuggingChoice();
  }

  // Space 49: Dratini - Roll die to catch
  if (finalLandedSpace.index === 49) {
    player.awaitingSpace49Roll = true;
    logLine(`${player.name} landed on Dratini!`);
    rollResult.textContent = `${player.name} landed on Dratini! Roll a 1 to catch it.`;
  }

  // Space 51: Chansey - Roll die to catch
  if (finalLandedSpace.index === 51) {
    player.awaitingSpace51Roll = true;
    logLine(`${player.name} landed on Chansey!`);
    rollResult.textContent = `${player.name} landed on Chansey! Click the Roll Die button to proceed.`;
  }

  // Space 54: Electabuzz - Lose next turn
  if (finalLandedSpace.index === 54) {
    player.skipNextTurn = true;
    logLine(`${player.name} landed on Electabuzz and loses their next turn!`);
    rollResult.textContent = `${player.name} is paralyzed! They lose their next turn.`;
  }

  // Space 57: Missingno - Roll up to 3 dice; 5 or 6 saves you, otherwise restart
  if (finalLandedSpace.index === 57) {
    player.missingnoRollsLeft = 3;
    logLine(`${player.name} encountered a Missingno! Roll up to 3 dice. A 5 or 6 saves you, otherwise restart!`);
    rollResult.textContent = `${player.name} encountered Missingno! Click Roll (${player.missingnoRollsLeft} roll${player.missingnoRollsLeft !== 1 ? 's' : ''} remaining).`;
  }

  // Space 58: Cinnabar Gym - Roll until odd; drink 2x the number of even rolls
  if (finalLandedSpace.index === 58) {
    player.awaitingSpace58Roll = true;
    player.space58EvenCount = 0;
    logLine(`${player.name} landed on Cinnabar Gym!`);
    rollResult.textContent = `${player.name} landed on Cinnabar Gym! Click the Roll Die button to proceed.`;
  }

  // Space 61: Throw Pokeball - Ask if favorite is on board
  if (finalLandedSpace.index === 61) {
    player.awaitingFavoritePokemonChoice = true;
    logLine(`${player.name} Is their favorite pokemon on the board?`);
    rollResult.textContent = `${player.name}, is your favorite pokemon on the game board?`;
    showFavoritePokemonChoice();
  }

  // Space 62: Persian - Roll die to give drinks
  if (finalLandedSpace.index === 62) {
    player.awaitingSpace62Roll = true;
    logLine(`${player.name} landed on Persian!`);
    rollResult.textContent = `${player.name} landed on Persian! Click the Roll Die button to proceed.`;
  }

  // Space 65: Graveler - Lose next 2 turns
  if (finalLandedSpace.index === 65) {
    player.turnsToSkip = 2;
    logLine(`${player.name} landed on Graveler and will lose their next 2 turns!`);
    rollResult.textContent = `${player.name} loses their next 2 turns.`;
  }

  // Space 66: Gyarados - Take 4 drinks unless landed on Magikarp (space 21)
  if (finalLandedSpace.index === 66) {
    if (player.landedOn21) {
      logLine(`${player.name} landed on Gyarados, but they had landed on Magikarp! They give 4 drinks.`);
      rollResult.textContent = `${player.name} rolled a ${landingRoll} and had previously landed on Magikarp! Give 4 drinks.`;
      player.landedOn21 = false;
    } else {
      logLine(`${player.name} landed on Gyarados and takes 4 drinks.`);
      rollResult.textContent = `${player.name} rolled a ${landingRoll}.`;
    }
  }

  // Space 67: Dragonite - Give 5 drinks and lose next turn
  if (finalLandedSpace.index === 67) {
    player.skipNextTurn = true;
    logLine(`${player.name} landed on Dragonite! They give 5 drinks and lose their next turn.`);
    rollResult.textContent = `${player.name} gives 5 drinks and loses their next turn.`;
  }

  // Space 68: Legendary Birds - Catch up to 3 birds (4-6 to catch, can't leave until 3 caught)
  if (finalLandedSpace.index === 68) {
    if (player.legendaryBirdsCaught === 0) {
      player.catchingLegendaryBirds = true;
      logLine(`${player.name} must catch 3 legendary birds. Click Roll to start.`);
      rollResult.textContent = `${player.name}, Roll to try catching the legendary birds (0/3).`;
    }
  }

  // Space 69: Elite Four - Must roll a 4 to continue, otherwise drink 4 and stay
  if (finalLandedSpace.index === 69) {
    player.stuckOnEliteFour = true;
    logLine(`${player.name} landed on the Elite Four! They must roll a 4 to defeat them.`);
    rollResult.textContent = `${player.name} encountered the Elite Four! Roll a 4 to defeat them.`;
  }

  // Space 70: Champion Gary - Ask if finished a full drink
  if (finalLandedSpace.index === 70) {
    player.awaitingDrinkQuestion = true;
    logLine(`${player.name} landed on Champion Gary!`);
    rollResult.textContent = `${player.name}, have you finished a full drink?`;
    showDrinkQuestion();
  }

  // Space 71: Pokemon Master - Player is finished and takes no more turns
  if (finalLandedSpace.index === 71) {
    player.finished = true;
    player.extraTurn = false;
    logLine(`${player.name} became a Pokemon Master and is finished with the game!`);
    rollResult.textContent = `${player.name} is now a Pokemon Master!`;
  }

  if (finalLandedSpace.color === 'grey') {
    const section = findGreySection(player.position);
    if (section && section.start === player.position) {
      player.activeGreyRule = section.rule;
      player.greySectionEnd = section.end;
      logLine(`${player.name} entered a grey section starting at ${player.position}: ${section.rule}`);
    }
  }


  // Only activate grey rule if player lands (not passes) on the first space of a grey section
  const section = greySections.find(({ start, end }) => player.position === start);
  if (section) {
    player.activeGreyRule = section.rule;
    player.greySectionEnd = section.end;
    logLine(`${player.name} landed on the first space of a grey section: ${section.rule}`);
  }

  // Deactivate grey rule if player leaves the section
  if (player.greySectionEnd != null && (player.position < (player.greySectionEnd - (player.greySectionEnd - section?.start)) || player.position > player.greySectionEnd)) {
    player.activeGreyRule = null;
    player.greySectionEnd = null;
    logLine(`${player.name} left the grey section and is no longer bound by that rule.`);
  }

  refreshBoardTokens();

  return finalLandedSpace;
  
  // Always show the space's description in rollResult if not already set by a special event
  // (This line must be after all special-case rollResult.textContent assignments)
  if (!rollResult.textContent || rollResult.textContent.trim() === '') {
    rollResult.textContent = finalLandedSpace.description;
  }
}

async function battleIfNeeded(player) {
  const opponents = players.filter((other) => other.id !== player.id && other.position === player.position);

  if (!opponents.length) {
    return;
  }
  const space = spaces[player.position];
  if (space.color !== 'white' && space.color !== 'start') {
    return;
  }

  // Show battle modal
  const battleModal = document.getElementById('battle-modal');
  const battleInfo = document.getElementById('battle-info');
  const battleCloseBtn = document.getElementById('battle-close-btn');
  const modalOverlay = battleModal.querySelector('.modal-overlay');

  for (let i = 0; i < opponents.length; i += 1) {
    const opponent = opponents[i];
    const battle = getBattleRolls(player.starter, opponent.starter);
    logLine(`${player.name} battles ${opponent.name} on ${space.name}!`);
    logLine(`${player.name} rolled ${battle.myBest} (${battle.myRolls} roll${battle.myRolls > 1 ? 's' : ''}).`);
    logLine(`${opponent.name} rolled ${battle.opponentBest} (${battle.opponentRolls} roll${battle.opponentRolls > 1 ? 's' : ''}).`);

    let resultText = '';
    if (battle.myBest > battle.opponentBest) {
      resultText = `${opponent.name} loses the battle and takes 2 drinks.`;
      logLine(resultText);
    } else if (battle.myBest < battle.opponentBest) {
      resultText = `${player.name} loses the battle and takes 2 drinks.`;
      logLine(resultText);
    } else {
      resultText = 'It is a tie. Both players take 1 drink.';
      logLine(resultText);
    }

    battleInfo.innerHTML = `
      <p>Battle ${i + 1} of ${opponents.length}</p>
      <p>Dice outcomes shown are the best rolls for each player (some players may have rolled multiple dice due to type advantages).</p>
      <p><strong>${player.name}</strong> (${player.starter})<br>Rolled: <span style="font-size: 1.2rem; color: var(--pokered);">🎲 ${battle.myBest}</span></p>
      <p><strong>vs</strong></p>
      <p><strong>${opponent.name}</strong> (${opponent.starter})<br>Rolled: <span style="font-size: 1.2rem; color: var(--pokeblue);">🎲 ${battle.opponentBest}</span></p>
      <p class="result">${resultText}</p>
    `;

    battleModal.classList.remove('hidden');

    await new Promise((resolve) => {
      const closeHandler = () => {
        battleModal.classList.add('hidden');
        battleCloseBtn.removeEventListener('click', closeHandler);
        modalOverlay.removeEventListener('click', closeHandler);
        resolve();
      };
      battleCloseBtn.addEventListener('click', closeHandler);
      modalOverlay.addEventListener('click', closeHandler);
    });
  }
}

async function handleRoll() {
  if (rollButton.disabled) return;
  if (isOnline() && !myTurnOnline()) return; // ignore stray clicks from spectators
  await prefetchDiceIfOnline(24);
  rollButton.disabled = true;
  const player = players[currentPlayerIndex];

  // Check if player is on space 70 (Champion Gary) - ask drink question each turn
  if (player.position === 70 && !player.championGaryCleared) {
    player.awaitingDrinkQuestion = true;
  }

  // Check if player is confused - they must roll to see if they stay confused
  if (player.confused) {
    const confusionRoll = getDiceRoll();
    if (confusionRoll >= 1 && confusionRoll <= 3) {
      logLine(`${player.name} rolled a ${confusionRoll}. They remain confused and their turn ends.`);
      rollResult.textContent = `${player.name} rolled a ${confusionRoll}. Still confused! Turn ends.`;
      nextTurnButton.disabled = false;
      rollButton.disabled = true;
      return;
    } else {
      player.confused = false;
      player.confusedBy = null;
      logLine(`${player.name} rolled a ${confusionRoll}. They are no longer confused!`);
      rollResult.textContent = `${player.name} rolled a ${confusionRoll}. Confusion cleared!`;
    }
  }

  // Check if player has turns to skip from space 18
  if (player.turnsToSkip > 0) {
    const remainingTurns = player.turnsToSkip - 1;
    logLine(`${player.name} is skipping this turn (S.S. Anne effect). They take ${player.drinksPerSkippedTurn} drinks. ${remainingTurns > 0 ? `${remainingTurns} missed turns remaining.` : 'No missed turns remaining.'}`);
    rollResult.textContent = `${player.name} skips this turn and takes ${player.drinksPerSkippedTurn} drinks. ${remainingTurns > 0 ? `${remainingTurns} missed turns remaining.` : 'They return next turn.'}`;
    player.turnsToSkip -= 1;
    if (player.turnsToSkip === 0) {
      logLine(`${player.name} has finished skipping turns.`);
    }
    nextTurnButton.disabled = false;
    rollButton.disabled = true;
    return;
  }

  // Check if player is awaiting turn 32 die roll
  if (player.awaitingTurn32Roll) {
    const turn32Roll = getDiceRoll();
    player.turn32Roll = turn32Roll;
    if (turn32Roll >= 1 && turn32Roll <= 3) {
      player.skipNextTurn = true;
      logLine(`${player.name} rolled a ${turn32Roll}. They lose their next turn!`);
      rollResult.textContent = `${player.name} rolled a ${turn32Roll}. They lose their next turn!`;
    } else {
      logLine(`${player.name} rolled a ${turn32Roll}. They must finish their drink!`);
      rollResult.textContent = `${player.name} rolled a ${turn32Roll}. They must finish their drink!`;
    }
    logLine(`${player.name} rolled a ${turn32Roll} (this does not affect movement).`);
    player.awaitingTurn32Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is awaiting lucky roll
  if (player.awaitingLuckyRoll) {
    const luckyRoll = getDiceRoll();
    if (player.luckyRollSpace === 6) {
      if (luckyRoll % 2 === 0) {
        rollResult.textContent = `${player.name} rolled a ${luckyRoll}, give a drink!`; 
        logLine(`${player.name} rolled a ${luckyRoll} and gives a drink to someone!`);
        } 
      else {
        rollResult.textContent = `${player.name} rolled a ${luckyRoll}, take a drink!`;
        logLine(`${player.name} rolled a ${luckyRoll} and takes a drink!`);
    }}
    if (player.luckyRollSpace === 12) {
        rollResult.textContent = `${player.name} rolled a ${luckyRoll}. Drink half, give half (round up).`;
        logLine(`${player.name} rolled a ${luckyRoll}. Drink half, give half (round up).`);
    }
    logLine(`${player.name} rolled a ${luckyRoll} (this does not affect movement).`);
    player.awaitingLuckyRoll = false;
    player.luckyRollSpace = null;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is awaiting favorite pokemon choice
  if (player.awaitingFavoritePokemonChoice) {
    showFavoritePokemonChoice();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player answered yes to favorite pokemon and needs to roll
  if (player.favoritePokemonOnBoard === true) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}.`);
    
    if (roll >= 1 && roll <= 3) {
      logLine(`${player.name} caught their favorite pokemon!`);
      rollResult.textContent = `${player.name} rolled a ${roll}. They caught their favorite pokemon!`;
    } else {
      logLine(`${player.name} did not catch their favorite. They take 3 drinks.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. They take 3 drinks.`;
    }
    
    player.favoritePokemonOnBoard = null;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is catching legendary birds on space 68
  if (player.catchingLegendaryBirds || (player.position === 68 && player.legendaryBirdsCaught > 0 && player.legendaryBirdsCaught < 3)) {
    player.catchingLegendaryBirds = true;
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll} (trying to catch bird ${player.legendaryBirdsCaught + 1}/3).`);
    
    if (roll >= 4) {
      player.legendaryBirdsCaught += 1;
      logLine(`${player.name} caught a legendary bird! (${player.legendaryBirdsCaught}/3)`);
      
      if (player.legendaryBirdsCaught === 3) {
        logLine(`${player.name} rolled a ${roll} and caught all 3 legendary birds! They get to roll and move on.`);
        rollResult.textContent = `${player.name} rolled a ${roll} and caught all 3! Click Roll to move.`;
        player.catchingLegendaryBirds = false;
        rollButton.disabled = false;
        nextTurnButton.disabled = true;
        return;
      } else {
        rollResult.textContent = `${player.name} rolled a ${roll} and caught one! (${player.legendaryBirdsCaught}/3)`;
        rollButton.disabled = true;
        nextTurnButton.disabled = false;
        return;
      }
    } else {
      logLine(`${player.name} failed to catch a bird. Their turn ends.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. No catch. Turn ends. (${player.legendaryBirdsCaught}/3)`;
      rollButton.disabled = true;
      nextTurnButton.disabled = false;
      return;
    }
  }

  // Check if player is stuck on Elite Four and needs to roll a 4
  if (player.stuckOnEliteFour) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll} against the Elite Four.`);
    
    if (roll === 4) {
      player.stuckOnEliteFour = false;
      player.extraTurn = true;
      logLine(`${player.name} rolled a ${roll}! They defeated the Elite Four and get to roll again!`);
      rollResult.textContent = `${player.name} rolled a ${roll}! Defeated! Click Roll to continue.`;
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
      return;
    } else {
      logLine(`${player.name} rolled a ${roll}. They drink 4 drinks and stay on The Elite Four.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Drink 4 and try again next turn.`;
      player.stuckOnEliteFour = true;
      rollButton.disabled = true;
      nextTurnButton.disabled = false;
      return;
    }
  }


  // Check if player is awaiting drink question on space 70
  if (player.awaitingDrinkQuestion) {
    showDrinkQuestion();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player is on space 18 (S.S. Anne) and needs to roll
  if (player.awaitingSpace18Roll) {
    const turnsMissed = getDiceRoll();
    player.space18TurnsMissed = turnsMissed;
    logLine(`${player.name} rolled a ${turnsMissed} and will miss ${turnsMissed} turn${turnsMissed !== 1 ? 's' : ''}.`);
    rollResult.textContent = `${player.name} rolled a ${turnsMissed}. They will miss ${turnsMissed} turn${turnsMissed !== 1 ? 's' : ''}. Click Roll to see drinks per missed turn.`;
    player.awaitingSpace18Roll = false;
    player.awaitingSpace18DrinksRoll = true;
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player is on space 18 and needs to roll for drinks per missed turn
  if (player.awaitingSpace18DrinksRoll) {
    const drinksPerTurn = getDiceRoll();
    player.turnsToSkip = player.space18TurnsMissed;
    player.drinksPerSkippedTurn = drinksPerTurn;
    logLine(`${player.name} rolled a ${drinksPerTurn} and will take ${drinksPerTurn} drink${drinksPerTurn !== 1 ? 's' : ''} per missed turn.`);
    rollResult.textContent = `${player.name} rolled a ${drinksPerTurn}. They take ${drinksPerTurn} drink${drinksPerTurn !== 1 ? 's' : ''} during each of their ${player.space18TurnsMissed} missed turn${player.space18TurnsMissed !== 1 ? 's' : ''}.`;
    player.awaitingSpace18DrinksRoll = false;
    player.space18TurnsMissed = 0;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 19 (Vermilion Gym) and needs to roll
  if (player.awaitingSpace19Roll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}.`);
    if (roll % 2 === 0) {
      player.skipNextTurn = true;
      logLine(`${player.name} rolled ${roll} (even). They take 2 drinks and will miss their next turn.`);
      rollResult.textContent = `${player.name} rolled a ${roll} (even). You're paralyzed! Miss next turn and take 2 drinks.`;
    } else {
      logLine(`${player.name} rolled ${roll} (odd). They take a drink and continue normally.`);
      rollResult.textContent = `${player.name} rolled a ${roll} (odd). Take 1 drink and continue!`;
    }
    player.awaitingSpace19Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 30 and needs to roll
  if (player.awaitingSpace30Roll) {
    const roll = getDiceRoll();
    const drinks = Math.max(0, roll - 1);
    logLine(`${player.name} rolled a ${roll}. They take ${drinks} drink${drinks !== 1 ? 's' : ''}.`);
    rollResult.textContent = `${player.name} rolled a ${roll}. Take ${drinks} drink${drinks !== 1 ? 's' : ''}.`;
    player.awaitingSpace30Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 40 (Giovanni) and needs to roll
  if (player.awaitingSpace40Roll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}.`);
    if (roll >= 1 && roll <= 3) {
      logLine(`${player.name} rolled ${roll} (1-3). They give ${roll} drink${roll !== 1 ? 's' : ''}.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Give ${roll} drink${roll !== 1 ? 's' : ''}.`;
    } else {
      logLine(`${player.name} rolled ${roll} (4-6). They drink ${roll} drink${roll !== 1 ? 's' : ''}.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Drink ${roll} drink${roll !== 1 ? 's' : ''}.`;
    }
    player.awaitingSpace40Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 49 (Dratini) and needs to roll
  if (player.awaitingSpace49Roll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}.`);
    if (roll === 1) {
      logLine(`${player.name} rolled a 1 and caught a Dratini!`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Caught a Dratini!`;
    } else {
      logLine(`${player.name} rolled a ${roll}. They take 1 drink.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Take 1 drink.`;
    }
    player.awaitingSpace49Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 51 (Chansey) and needs to roll
  if (player.awaitingSpace51Roll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}.`);
    if (roll >= 1 && roll <= 3) {
      logLine(`${player.name} rolled ${roll} (1-3). They missed Chansey and take 1 drink.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Missed Chansey! Take 1 drink.`;
    } else {
      logLine(`${player.name} rolled ${roll} (4-6). They captured Chansey and give 2 drinks.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Captured Chansey! Give 2 drinks.`;
    }
    player.awaitingSpace51Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 58 (Cinnabar Gym) and needs to roll until odd
  if (player.awaitingSpace58Roll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}.`);
    
    if (roll % 2 === 0) {
      player.space58EvenCount += 1;
      logLine(`${player.name} rolled even. Rolling again... (${player.space58EvenCount} even so far)`);
      rollResult.textContent = `${player.name} rolled a ${roll} (even). Click Roll again. (${player.space58EvenCount} even so far)`;
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
    } else {
      const drinks = player.space58EvenCount * 2;
      logLine(`${player.name} rolled ${roll} (odd). Done! They drink ${drinks} drink${drinks !== 1 ? 's' : ''}.`);
      rollResult.textContent = `${player.name} rolled a ${roll} (odd). Rolled even ${player.space58EvenCount} time${player.space58EvenCount !== 1 ? 's' : ''}. Drink ${drinks}.`;
      player.awaitingSpace58Roll = false;
      player.space58EvenCount = 0;
      rollButton.disabled = true;
      nextTurnButton.disabled = false;
    }
    return;
  }

  // Check if player is on space 62 (Persian) and needs to roll
  if (player.awaitingSpace62Roll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}. They give out ${roll} drink${roll !== 1 ? 's' : ''}.`);
    rollResult.textContent = `${player.name} rolled a ${roll}. Give ${roll} drink${roll !== 1 ? 's' : ''}.`;
    player.awaitingSpace62Roll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is on space 42 and must roll for drinks before ending turn
  if (player.awaitingSpace42DrinkRoll) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll} on Gary and must take ${roll} drink${roll !== 1 ? 's' : ''}.`);
    rollResult.textContent = `${player.name} rolled a ${roll} on Gary. Take ${roll} drink${roll !== 1 ? 's' : ''}.`;
    player.awaitingSpace42DrinkRoll = false;
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Check if player is in a Missingno roll sequence
  if (player.missingnoRollsLeft > 0) {
    const roll = getDiceRoll();
    player.missingnoRollsLeft -= 1;
    logLine(`${player.name} rolled a ${roll} (Missingno roll, ${player.missingnoRollsLeft} remaining).`);
    if (roll >= 5) {
      player.missingnoRollsLeft = 0;
      logLine(`${player.name} rolled a ${roll} and escaped Missingno! They continue play.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Safe from Missingno!`;
      rollButton.disabled = true;
      nextTurnButton.disabled = false;
    } else if (player.missingnoRollsLeft > 0) {
      logLine(`${player.name} rolled a ${roll}. Not safe yet. ${player.missingnoRollsLeft} roll${player.missingnoRollsLeft !== 1 ? 's' : ''} remaining.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. Click Roll again (${player.missingnoRollsLeft} roll${player.missingnoRollsLeft !== 1 ? 's' : ''} remaining).`;
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
    } else {
      player.position = 0;
      refreshBoardTokens();
      updateStatus();
      logLine(`${player.name} glitched! They restart back to the beginning.`);
      rollResult.textContent = `${player.name} glitched! Restarting from the beginning.`;
      rollButton.disabled = true;
      nextTurnButton.disabled = false;
    }
    return;
  }

  // Check if player is awaiting number pick for Saffron Gym
  if (player.awaitingNumberPick) {
    showNumberPickChoice();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player picked a number and needs to roll to match
  if (player.pickedNumber !== null) {
    const roll = getDiceRoll();
    logLine(`${player.name} rolled a ${roll}. They picked ${player.pickedNumber}.`);
    
    if (roll === player.pickedNumber) {
      player.extraTurn = true;
      logLine(`${player.name} is psychic! They get an extra turn!`);
      rollResult.textContent = `${player.name} rolled a ${roll} and had used their psychic abilities to correctly predict ${player.pickedNumber}! They get an extra turn!`;
      rollButton.disabled = false;
      nextTurnButton.disabled = true;
    } else {
      logLine(`${player.name} did not match. They take 2 drinks.`);
      rollResult.textContent = `${player.name} rolled a ${roll}. No match. Take 2 drinks.`;
      rollButton.disabled = true;
      nextTurnButton.disabled = false;
    }
    
    player.pickedNumber = null;
    return;
  }

  // Check if player is awaiting confusion choice
  if (player.awaitingConfusionChoice) {
    showConfusionChoice();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player is awaiting chugging choice
  if (player.awaitingChuggingChoice) {
    showChuggingChoice();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player is awaiting chugging result
  if (player.awaitingChuggingResult) {
    showChuggingResult();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player is awaiting evolution choice
  if (player.awaitingEvolution) {
    showEvolutionChoice();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Check if player is awaiting player choice
  if (player.awaitingPlayerChoice) {
    showPlayerChoice();
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
    return;
  }

  // Clear extra turn flag if it's being used now
  if (player.extraTurn) {
    player.extraTurn = false;
  }

  if (player.skipNextTurn) {
    logLine(`${player.name} must skip this turn.`);
    player.skipNextTurn = false;
    rollResult.textContent = `${player.name} skipped the turn.`;
    nextTurnButton.disabled = false;
    rollButton.disabled = true;
    return;
  }

  // Grey Zone (48-51): roll before movement each turn while still in the zone.
  if (player.position >= 48 && player.position <= 51 && !player.awaitingSafariMovementRoll) {
    const safariRoll = getDiceRoll();

    if (safariRoll <= 2) {
      logLine(`${player.name} rolled a ${safariRoll} in the Safari Zone (1-2): throw bait and give 1 drink.`);
      rollResult.textContent = `${player.name} rolled a ${safariRoll} in the Safari Zone. Throw bait: give 1 drink. Now roll for movement.`;
    } else if (safariRoll <= 4) {
      logLine(`${player.name} rolled a ${safariRoll} in the Safari Zone (3-4): throw a rock, lose turn, drink 4.`);
      rollResult.textContent = `${player.name} rolled a ${safariRoll} in the Safari Zone. Throw a rock: lose this turn and drink 4.`;
      nextTurnButton.disabled = false;
      rollButton.disabled = true;
      return;
    } else {
      logLine(`${player.name} rolled a ${safariRoll} in the Safari Zone (5-6): throw a safari ball and drink 2.`);
      rollResult.textContent = `${player.name} rolled a ${safariRoll} in the Safari Zone. Throw a safari ball: drink 2. Now roll for movement.`;
    }

    player.awaitingSafariMovementRoll = true;
    rollButton.disabled = false;
    return;
  }

  player.awaitingSafariMovementRoll = false;

  const originalDie = getDiceRoll();
  await showDiceAnimation(originalDie);
  let movement = originalDie;

  // Special rule for space 8: if the player rolls 1 or 2, do not move and end turn.
  if (player.position === 8 && originalDie <= 2) {
    rollResult.textContent = `${player.name} rolled a ${originalDie} on Zubats and does not move.`;
    logLine(`${player.name} rolled a ${originalDie} on Zubats and their turn ends without moving.`);
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
    return;
  }

  // Apply halved movement if applicable
  if (player.nextTurnHalved) {
    movement = Math.ceil(originalDie / 2);
    rollResult.textContent = `${player.name} rolled a ${originalDie}. Their movement is halved to ${movement} spaces.`;
    logLine(`${player.name} rolled a ${originalDie}. Their movement is halved to ${movement} spaces.`);
    player.nextTurnHalved = false;
  } else if (player.nextTurnDoubled) {
    movement = originalDie * 2;
    rollResult.textContent = `${player.name} rolled a ${originalDie}. Their movement is doubled to ${movement} spaces.`;
    logLine(`${player.name} rolled a ${originalDie}. Their movement is doubled to ${movement} spaces.`);
    player.nextTurnDoubled = false;
  } else {
    rollResult.textContent = `${player.name} rolled a ${originalDie}.`;
    logLine(`${player.name} rolled a ${originalDie}.`);
  }
  
  const landedSpace = await movePlayer(player, movement, originalDie);
  await battleIfNeeded(player);
  updateStatus();
  
  // Keep roll button enabled if player is awaiting any special rolls or choices
  if (player.awaitingFavoritePokemonChoice) {
    rollButton.disabled = true;
    nextTurnButton.disabled = true;
  }
  else if (player.awaitingLuckyRoll || player.awaitingTurn32Roll || player.awaitingSpace18Roll || player.awaitingSpace18DrinksRoll || 
      player.awaitingSpace19Roll || player.awaitingSpace30Roll || player.awaitingSpace40Roll ||
      player.awaitingSpace49Roll || player.awaitingSpace51Roll || player.awaitingSpace58Roll ||
      player.awaitingSpace62Roll || player.awaitingSpace42DrinkRoll || player.awaitingEvolution || player.awaitingPlayerChoice ||
      player.awaitingConfusionChoice || player.awaitingChuggingChoice || player.awaitingChuggingResult || player.awaitingNumberPick || 
      player.pickedNumber !== null || 
      player.favoritePokemonOnBoard === true || player.awaitingDrinkQuestion ||
      player.catchingLegendaryBirds || player.stuckOnEliteFour ||
      player.missingnoRollsLeft > 0) {
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
  }
  // If player just got an extra turn, keep roll button enabled
  else if (player.extraTurn) {
    rollButton.disabled = false;
    nextTurnButton.disabled = true;
  } else {
    rollButton.disabled = true;
    nextTurnButton.disabled = false;
  }
}

function nextTurn() {
  const currentPlayer = players[currentPlayerIndex];

  if (currentPlayer.finished) {
    currentPlayer.extraTurn = false;
  }
  
  // Check if current player has an extra turn
  if (!currentPlayer.finished && currentPlayer.extraTurn) {
    currentPlayer.extraTurn = false;
    logLine(`${currentPlayer.name} gets their extra turn!`);
  } else {
    const nextIndex = players.findIndex((_, offset) => !players[(currentPlayerIndex + offset + 1) % players.length].finished);

    if (nextIndex === -1) {
      gameState.textContent = 'All players are Pokemon Masters. Game over!';
      rollResult.textContent = 'All players are Pokemon Masters!';
      rollButton.disabled = true;
      nextTurnButton.disabled = true;
      return;
    }

    currentPlayerIndex = (currentPlayerIndex + nextIndex + 1) % players.length;
    logLine(`Turn moves to ${players[currentPlayerIndex].name}.`);
  }
  
  updateStatus();
  rollResult.textContent = '';
  nextTurnButton.disabled = true;
  rollButton.disabled = false;
}

function resetGame() {
  players = [];
  currentPlayerIndex = 0;
  gameStarted = false;
  gameLogEntries = [];
  gameState.textContent = 'Set up the game to begin.';
  rollButton.disabled = true;
  nextTurnButton.disabled = true;
  currentPlayerCard.classList.add('hidden');
  spaceDescription.classList.add('hidden');
  gameLog.innerHTML = '';
  rollResult.textContent = '';
  refreshBoardTokens();

  // Show the player setup section
  document.querySelector('.game-setup').style.display = 'block';
}

function startGame() {
  const count = Number(playerCountSelect.value);
  const newPlayers = [];

  const nameInputs = playerEntries.querySelectorAll('[data-player-name]');
  const starterInputs = playerEntries.querySelectorAll('[data-player-starter]');

  nameInputs.forEach((input, index) => {
    newPlayers.push({
      id: index,
      name: input.value.trim() || `Player ${index + 1}`,
      starter: starterInputs[index].value,
      position: 0,
      initial: input.value.trim().charAt(0).toUpperCase() || `P${index + 1}`,
      activeGreyRule: null,
      greySectionEnd: null,
      skipNextTurn: false,
      extraTurn: false,
      nextTurnHalved: false,
      nextTurnDoubled: false,
      awaitingLuckyRoll: false,
      luckyRollSpace: null,
      turnsToSkip: 0,
      drinksPerSkippedTurn: 0,
      landedOn21: false,
      awaitingPlayerChoice: false,
      choiceSpace: null,
      awaitingTurn32Roll: false,
      turn32Roll: null,
      awaitingEvolution: false,
      awaitingConfusionChoice: false,
      confused: false,
      confusedBy: null,
      awaitingNumberPick: false,
      pickedNumber: null,
      missingnoRollsLeft: 0,
      awaitingFavoritePokemonChoice: false,
      favoritePokemonOnBoard: null,
      legendaryBirdsCaught: 0,
      catchingLegendaryBirds: false,
      stuckOnEliteFour: false,
      awaitingDrinkQuestion: false,
      championGaryCleared: false,
      finished: false,
      awaitingSpace18Roll: false,
      awaitingSpace18DrinksRoll: false,
      space18TurnsMissed: 0,
      awaitingSpace19Roll: false,
      awaitingSafariMovementRoll: false,
      awaitingChuggingChoice: false,
      awaitingChuggingResult: false,
      chuggingOpponent: null,
      awaitingSpace30Roll: false,
      awaitingSpace40Roll: false,
      awaitingSpace49Roll: false,
      awaitingSpace51Roll: false,
      awaitingSpace58Roll: false,
      space58EvenCount: 0,
      awaitingSpace62Roll: false,
      awaitingSpace42DrinkRoll: false,
      justEvolved: false
    });
  });

  players = newPlayers;
  currentPlayerIndex = 0;
  gameStarted = true;

  // Hide the player setup section
  document.querySelector('.game-setup').style.display = 'none';

  renderBoardOverlay();
  refreshBoardTokens();
  updateStatus();
  rollButton.disabled = false;
  nextTurnButton.disabled = true;
  gameState.textContent = `Game started with ${players.length} player${players.length > 1 ? 's' : ''}.`;
  logLine('Game started. Pallet Town is the starting position.');
}

playerCountSelect.addEventListener('change', () => {
  createPlayerRows(Number(playerCountSelect.value));
});

startButton.addEventListener('click', () => {
  // The local "Start Game" button only starts a local game. Online games are
  // started by the host via the separate "Start Game" button next to the roster.
  startGame();
});
rollButton.addEventListener('click', () => handleRoll().then(() => schedulePushState()));
nextTurnButton.addEventListener('click', () => { nextTurn(); schedulePushState(); });
resetButton.addEventListener('click', () => {
  if (confirm('Are you sure you want to reset the game?')) {
    resetGame();
    schedulePushState();
  }
});

setUpBoardPositions();
createPlayerRows(Number(playerCountSelect.value));
renderBoardOverlay();
updateStatus();

// ─── Lobby + network bootstrap ───
function buildPlayerObject(index, name, starter) {
  return {
    id: index,
    name: (name || `Player ${index + 1}`).toString().slice(0, 20),
    starter: starter || 'Charmander',
    position: 0,
    initial: (name || '').toString().trim().charAt(0).toUpperCase() || `P${index + 1}`,
    activeGreyRule: null,
    greySectionEnd: null,
    skipNextTurn: false,
    extraTurn: false,
    nextTurnHalved: false,
    nextTurnDoubled: false,
    awaitingLuckyRoll: false,
    luckyRollSpace: null,
    turnsToSkip: 0,
    drinksPerSkippedTurn: 0,
    landedOn21: false,
    awaitingPlayerChoice: false,
    choiceSpace: null,
    awaitingTurn32Roll: false,
    turn32Roll: null,
    awaitingEvolution: false,
    awaitingConfusionChoice: false,
    confused: false,
    confusedBy: null,
    awaitingNumberPick: false,
    pickedNumber: null,
    missingnoRollsLeft: 0,
    awaitingFavoritePokemonChoice: false,
    favoritePokemonOnBoard: null,
    legendaryBirdsCaught: 0,
    catchingLegendaryBirds: false,
    stuckOnEliteFour: false,
    awaitingDrinkQuestion: false,
    championGaryCleared: false,
    finished: false,
    awaitingSpace18Roll: false,
    awaitingSpace18DrinksRoll: false,
    space18TurnsMissed: 0,
    awaitingSpace19Roll: false,
    awaitingSafariMovementRoll: false,
    awaitingChuggingChoice: false,
    awaitingChuggingResult: false,
    chuggingOpponent: null,
    awaitingSpace30Roll: false,
    awaitingSpace40Roll: false,
    awaitingSpace49Roll: false,
    awaitingSpace51Roll: false,
    awaitingSpace58Roll: false,
    space58EvenCount: 0,
    awaitingSpace62Roll: false,
    awaitingSpace42DrinkRoll: false,
    justEvolved: false
  };
}

function startGameFromRoster(roster) {
  players = roster.map((p, i) => buildPlayerObject(i, p.name, p.starter));
  currentPlayerIndex = 0;
  gameStarted = true;
  gameLogEntries = [];
  document.querySelector('.game-setup').style.display = 'none';
  renderBoardOverlay();
  refreshBoardTokens();
  updateStatus();
  gameLog.innerHTML = '';
  rollButton.disabled = false;
  nextTurnButton.disabled = true;
  gameState.textContent = `Game started with ${players.length} player${players.length > 1 ? 's' : ''}.`;
  logLine('Game started. Pallet Town is the starting position.');
}

(function initLobby() {
  const modeCreateBtn = document.getElementById('mode-create');
  const modeJoinBtn = document.getElementById('mode-join');
  const modeLocalBtn = document.getElementById('mode-local');
  const formCreate = document.getElementById('mode-create-form');
  const formJoin = document.getElementById('mode-join-form');
  const formLocal = document.getElementById('mode-local-form');

  const nameCreate = document.getElementById('online-name-create');
  const starterCreate = document.getElementById('online-starter-create');
  const nameJoin = document.getElementById('online-name-join');
  const starterJoin = document.getElementById('online-starter-join');
  const joinCode = document.getElementById('join-code');
  const createBtn = document.getElementById('create-room-btn');
  const joinBtn = document.getElementById('join-room-btn');

  const statusEl = document.getElementById('online-status');
  const rosterEl = document.getElementById('online-roster');
  const rosterList = document.getElementById('online-roster-list');
  const hostHint = document.getElementById('online-host-hint');
  const startOnlineBtn = document.getElementById('start-game-online');

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function showMode(which) {
    [formCreate, formJoin, formLocal].forEach((f) => f && f.classList.add('hidden'));
    [modeCreateBtn, modeJoinBtn, modeLocalBtn].forEach((b) => b && b.classList.remove('active'));
    if (which === 'create') { formCreate?.classList.remove('hidden'); modeCreateBtn?.classList.add('active'); }
    if (which === 'join')   { formJoin?.classList.remove('hidden');   modeJoinBtn?.classList.add('active'); }
    if (which === 'local')  { formLocal?.classList.remove('hidden');  modeLocalBtn?.classList.add('active'); }
  }

  modeCreateBtn?.addEventListener('click', () => {
    if (!window.net) { setStatus('Online play unavailable (server not reachable).'); return; }
    showMode('create');
  });
  modeJoinBtn?.addEventListener('click', () => {
    if (!window.net) { setStatus('Online play unavailable (server not reachable).'); return; }
    showMode('join');
  });
  modeLocalBtn?.addEventListener('click', () => showMode('local'));

  if (!window.net) return; // offline-only: skip online wiring

  async function doCreate() {
    try {
      const name = (nameCreate?.value || '').trim() || 'Player 1';
      const starter = starterCreate?.value || 'Charmander';
      const res = await window.net.createRoom({ name, starter });
      setStatus(`Room created: ${res.code}. Share this code with friends.`);
      enterOnlineLobby(true);
    } catch (e) { setStatus('Error: ' + e.message); }
  }
  async function doJoin() {
    try {
      const name = (nameJoin?.value || '').trim() || 'Player';
      const starter = starterJoin?.value || 'Charmander';
      const code = (joinCode?.value || '').trim().toUpperCase();
      if (!code) { setStatus('Enter a room code first.'); return; }
      const res = await window.net.joinRoom({ code, name, starter });
      setStatus(`Joined room ${res.code}.`);
      enterOnlineLobby(false);
    } catch (e) { setStatus('Error: ' + e.message); }
  }

  function enterOnlineLobby(isHost) {
    // Hide the mode picker and all forms; the roster + host's start button
    // are the only things visible while waiting for the game to start.
    document.getElementById('mode-picker')?.classList.add('hidden');
    [formCreate, formJoin, formLocal].forEach((f) => f && f.classList.add('hidden'));
    rosterEl?.classList.remove('hidden');
    if (startOnlineBtn) {
      startOnlineBtn.classList.toggle('hidden', !isHost);
    }
    if (hostHint) {
      hostHint.textContent = isHost
        ? 'You are the host. Click Start Game when everyone is in.'
        : 'Waiting for the host to start the game…';
    }
  }

  createBtn?.addEventListener('click', doCreate);
  joinBtn?.addEventListener('click', doJoin);

  startOnlineBtn?.addEventListener('click', () => {
    if (!window.net.players || window.net.players.length === 0) return;
    startGameFromRoster(window.net.players);
    window.net.startGame(serializeState()).catch((err) => console.error(err));
  });

  window.net.onRoom((room) => {
    if (rosterEl) rosterEl.classList.remove('hidden');
    if (rosterList) {
      rosterList.innerHTML = '';
      room.players.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = `${p.name} (${p.starter})`;
        if (!p.online) li.classList.add('offline');
        rosterList.appendChild(li);
      });
    }
    // If the host already started the game and we just joined, sync to it.
    if (room.state && !gameStarted) {
      applyRemoteSnapshot(room.state);
    }
  });

  window.net.onSnapshot((snap) => {
    applyRemoteSnapshot(snap);
  });
})();
