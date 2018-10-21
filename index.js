/**
 * Integration with the Gossip inter-MUD communication protocol.
 * 
 * See {@link https://gossip.haus Gossip} for more information.
 *
 * {@link https://github.com/dinchak/node-gossiphaus Repository}
 * 
 * @author Tom Dinchak <dinchak@gmail.com>
 */

const EventEmitter = require('events')

const debug = require('debug')('gossiphaus')
const WebSocket = require('ws')
const uuid = require('uuid/v4')

/**
 * Array of player names currently online in the local game
 * @type {Array.<string>}
 */
let players = []

/**
 * Array of games discovered on the gossip network
 * @type {Array.<string>}
 */
let games = []

/**
 * Websocket connection object
 * @type {WebSocket}
 */
let conn

/**
 * Event emitter to handle responses
 * @type {EventEmitter}
 */
let emitter

/**
 * Configuration object
 * @type {Object}
 */
let config

/**
 * Default websocket URL
 * @type {string}
 */
let url = 'wss://gossip.haus/socket'

/**
 * True if the connection is up
 * @type {boolean}
 */
let alive = false

/**
 * How long to wait/collect game statuses before resolving connect()
 * @type {Number}
 */
let statusWait = 100

/**
 * Reconnect interval identifier
 * @type {Number}
 */
let reconnectInterval

/**
 * Ref to payload cache for associating responses with the original request payloads
 * @type {Object}
 */
let refs = {}

/**
 * Initialize the gossip connection.  client_id and client_secret are required, but the
 * rest have defaults.  Configuration options are as follows:
 *   
 *   client_id: Your gossip client_id
 *   client_secret: Your gossip client_secret
 *   statusWait: how long to wait for status messages on connect before resolving (in ms)
 *   reconnectInterval: how long to wait between reconnect attempts
 *   url: gossip websocket url
 *   
 * See https://gossip.haus/docs#authenticate for additional options.
 * 
 * Example with all options:
 * 
 * {
 *   client_id: '12345678-1234-1234-1234-123456789abc',
 *   client_secret: '12345678-1234-1234-1234-123456789abc',
 *   statusWait: 100,
 *   reconnectIntervalTime: 5000,
 *   url: 'wss://gossip.haus/socket',
 *   supports: ['channels', 'players', 'tells'],
 *   channels: ['testing', 'gossip'],
 *   version: '2.0.0',
 *   user_agent: 'MudEngine v0.1'
 * }
 * 
 * @param {Object} setConfig Configuration object, client_id and client_secret are required
 * @returns {EventEmitter} EventEmitter for async message handling
 */
function init(setConfig) {
  config = setConfig || {}

  if (config.hasOwnProperty('url')) {
    url = config.url
    delete config.url
  }
  if (config.hasOwnProperty('statusWait')) {
    statusWait = config.statusWait
    delete config.statusWait
  }
  if (config.hasOwnProperty('reconnectIntervalTime')) {
    reconnectInterval = config.reconnectIntervalTime
    delete config.reconnectIntervalTime
  }

  emitter = new EventEmitter()
  return emitter
}

/**
 * Opens the websocket connection and initializes event listeners.
 * 
 * @returns {Promise} Resolves after gossip authentication
 */
function connect() {
  return new Promise((resolve, reject) => {
    if (alive) {
      reject(new Error('Attempted to connect() with active connection, call .close() first'))
      return
    }

    conn = new WebSocket(url)
    
    if (!config.client_id) {
      throw new Error('client_id is required')
    }
    
    if (!config.client_secret) {
      throw new Error('client_secret is required')
    }
    
    conn.on('open', async () => {
      try {
        debug('websocket connection opened to ' + url)

        let payload = Object.assign({
          supports: ['channels', 'players', 'tells', 'games'],
          channels: ['testing', 'gossip']
        }, config)

        await send('authenticate', payload, false)
        await send('games/status')
        await send('players/status')

        scheduleReconnect(20)

        setTimeout(() => {
          resolve()
        }, statusWait)
      } catch (err) {
        scheduleReconnect(5)
        reject(err)
      }
    })

    conn.on('message', async (json) => {
      try {
        debug('received: ' + json)
        let data = JSON.parse(json)
        await messageHandler(data)
      } catch (err) {
        emitter.emit('error', err)
      }
    })

    conn.on('close', () => {
      debug('connection closed, will reconnect')
      alive = false
      scheduleReconnect(5)
    })

    conn.on('error', () => {
      debug('connection error, will reconnect')
      alive = false
      scheduleReconnect(5)
    })
  })
}

/**
 * Schedule a reconnect attempt.  Receiving a heartbeat message will reset
 * the timer.
 */
function scheduleReconnect(seconds) {
  debug('will reconnect in ' + seconds + ' seconds')
  if (reconnectInterval) {
    clearTimeout(reconnectInterval)
  }

  reconnectInterval = setTimeout(async () => {
    try {
      debug('reconnecting')
      alive = false
      conn.close()
      await connect()
    } catch (err) {
      emitter.emit('error', err)
    }
  }, seconds * 1000)
}

/**
 * Closes the websocket connection
 */
async function close() {
  try {
    alive = false
    conn.close()
  } catch (err) {
    emitter.emit(err)
  }
}

/**
 * Sends an event to gossip.  See https://gossip.haus/docs for more info.  Example:
 *
 *   let payload = await send('channels/subscribe', {channel: 'gossip'})
 * 
 * @param {string} event Event name
 * @param {Object} payload Payload object
 * @param {boolean} ref true if a ref should be generated and included (defaults true)
 * @returns {Promise} Resolves the payload object after receiving an acknowledgement
 */
function send(event, payload, ref = true) {
  return new Promise((resolve, reject) => {
    let packet = {event, payload}

    if (ref) {
      packet.ref = uuid()
      refs[packet.ref] = payload
    }

    let key = `${event}:${packet.ref || ''}`
    emitter.removeAllListeners(key)
    emitter.once(key, (msg) => {
      if (msg.error) {
        reject(new Error(msg.error))
        return
      }
      resolve(msg)
    })

    let json = JSON.stringify(packet)
    debug('send: ' + json) 
    conn.send(json, async (err) => {
      if (!err) {
        return
      }
      debug('error received, will reconnect')
      await close()
      scheduleReconnect(5)
      reject(err)
    })
  })
}

/**
 * Handles an incoming message from gossip.
 * 
 * @param {Object} msg {event, payload, ref, status, error}
 */
async function messageHandler(msg) {
  let payload = {}

  if (msg.ref) {
    payload = refs[msg.ref]
    delete refs[msg.ref]
  }

  if (msg.error) {
    if (msg.event == 'tells/send' && msg.error == 'game offline') {
      let game = games.find(g => g.game == payload.to_game)
      if (game) {
        debug(`${payload.to_game} is offline, marking as disconnected`)
        game.connected = false
      }
    }
    if (msg.event == 'games/status' && msg.error == 'unknown game') {
      let game = games.find(g => g.game == payload.to_game)
      if (game) {
        debug(`${payload.to_game} is offline, marking as disconnected`)
        game.connected = false
      }
    }
    if (msg.event == 'tells/send' && msg.error == 'player offline') {
      let game = games.find(g => g.name == payload.to_game)
      if (game && game.players.find(name => name == payload.to_name)) {
        debug(`${payload.to_name} is offline, removing from players list`)      
        game.players = game.players.filter(name => name != payload.to_name)
      }
    }

    emitter.emit(`${msg.event}:${msg.ref}`, msg)
    throw new Error(msg.error)
  }

  msg.payload = msg.payload || {}
  msg.ref = msg.ref || ''

  if (msg.event == 'heartbeat') {
    alive = true
    scheduleReconnect(20)
    await send('heartbeat', {players}, false)
  }

  if (msg.event == 'authenticate') {
    alive = true
  }

  if (msg.event == 'restart') {
    debug('restart received, closing connection')
    await close()
    scheduleReconnect(5)
  }

  if (msg.event == 'channels/broadcast') {
    emitter.emit(msg.event, msg.payload)
  }

  if (msg.event == 'tells/receive') {
    emitter.emit(msg.event, msg.payload)
  }

  if (msg.event == 'games/status') {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      games.push(Object.assign({connected: true}, msg.payload))
    } else {
      for (let key in msg.payload) {
        game[key] = msg.payload[key]
      }
    }
  }

  if (msg.event == 'games/connect') {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      await send('games/status', {game: msg.payload.game})
    }
    game = games.find(g => g.game == msg.payload.game)
    if (game) {
      game.connected = true
    }
  }

  if (msg.event == 'games/disconnect') {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      await send('games/status', {game: msg.payload.game})
    }
    game = games.find(g => g.game == msg.payload.game)
    if (game) {
      game.connected = false
    }
  }

  if (msg.event == 'players/status') {
    let game = games.find(g => g.game == msg.payload.game)
    if (game) {
      for (let key in msg.payload) {
        game[key] = msg.payload[key]
      }
    } else {
      games.push(msg.payload)
    }
  }

  if (msg.event == 'players/sign-in' && msg.payload.game) {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      await send('games/status', {game: msg.payload.game})
      await send('players/status', {game: msg.payload.game})
      game = games.find(g => g.game == msg.payload.game)
    }
    if (game) {
      if (!game.players) {
        game.players = []
      }
      if (!game.players.includes(msg.payload.name)) {
        game.players.push(msg.payload.name)
      }
    }
  }

  if (msg.event == 'players/sign-out' && msg.payload.game) {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      await send('games/status', {game: msg.payload.game})
      await send('players/status', {game: msg.payload.game})
      game = games.find(g => g.game == msg.payload.game)
    }
    if (game && game.players.includes(msg.payload.name)) {
      game.players = game.players.filter(n => n != msg.payload.name)
    }
  }

  emitter.emit(`${msg.event}:${msg.ref}`, msg)
}

/**
 * Add a player and announce it to the gossip network.
 * 
 * @param {string} name The player name
 * @returns {Promise} Resolves when the user is registered on gossip
 */
function addPlayer(name) {
  if (!players.includes(name)) {
    players.push(name)
  }
  return send('players/sign-in', {name})
}

/**
 * Remove a player and announce it to the gossip network.
 * 
 * @param {string} name The player name
 * @returns {Promise} Resolves when the user is removed from gossip
 */
function removePlayer(name) {
  players = players.filter(n => n != name)
  return send('players/sign-out', {name})
}

/**
 * Validates that a player-entered remote identifier is logged in and
 * returns an object representing that remote player with proper
 * capitalization.
 * @param {string} remoteName A player-entered remote player identifier
 * @returns {Object} An object representing the remote player
 */
function findPlayer(remoteName) {
  let [playerName, gameName] = remoteName.split('@')

  let game = games.find(g => g.game.toLowerCase() == gameName.toLowerCase())
  if (!game) {
    return false
  }

  let name = game.players.find(n => n.toLowerCase() == playerName.toLowerCase())
  if (!name) {
    return false
  }

  return {game: game.game, name}
}

/**
 * True if the connection to gossip is open and authenticated.
 * @returns {boolean} true if the connection to gossip is available
 */
function isAlive() {
  return alive
}

module.exports = {
  init, connect, close, send, isAlive, addPlayer, removePlayer, findPlayer, games
}