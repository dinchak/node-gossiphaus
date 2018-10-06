/**
 * Integration with the Gossip inter-MUD communication protocol.
 * See {@link https://gossip.haus Gossip} for more information.
 * {@link https://github.com/dinchak/node-gossiphaus Repository}
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
 * Time between reconnect attempts
 * @type {Number}
 */
let reconnectIntervalTime = 5 * 1000

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
      reject(new Error('Attempted to reconnect with active connection, call .close() first'))
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
          supports: ['channels', 'players', 'tells'],
          channels: ['testing', 'gossip']
        }, config)

        await send('authenticate', payload, false)
        await send('players/status')

        setTimeout(() => {
          resolve()
        }, statusWait)
      } catch (err) {
        reject(err)
      }
    })

    conn.on('message', async (json) => {
      try {
        debug('received: ' + json)
        let data = JSON.parse(json)
        await messageHandler(data)
      } catch (err) {
        reject(err)
        // emitter.emit('error', err)
      }
    })

    conn.on('close', () => {
      debug('connection closed, will reconnect')
      alive = false
    })

    if (!reconnectInterval) {
      reconnectInterval = setInterval(async () => {
        try {
          if (!alive) {
            debug('reconnecting')
            await connect()
          }
        } catch (err) {
          emitter.emit('error', err)
        }
      }, reconnectIntervalTime)
    }
  })
}

/**
 * Closes the websocket connection
 */
async function close() {
  for (let name of players) {
    await send('players/sign-out', {name})
  }
  alive = false
  conn.close()
  clearInterval(reconnectInterval)
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
    }

    let key = `${event}:${packet.ref || ''}`
    emitter.removeAllListeners(key)
    emitter.once(key, resolve)

    let json = JSON.stringify(packet)
    debug('send: ' + json) 
    conn.send(json, (err) => {
      if (!err) {
        return
      }
      alive = false
      debug('error received, will reconnect')
      connect()
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
  if (msg.error) {
    throw new Error(msg.error)
  }

  if (msg.event == 'heartbeat') {
    alive = true
    await send('heartbeat', {players}, false)
  }

  if (msg.event == 'authenticate') {
    alive = true
  }

  if (msg.event == 'restart') {
    debug('restart received, closing connection')
    await close()
  }

  msg.payload = msg.payload || {}
  msg.ref = msg.ref || ''

  if (msg.event == 'channels/broadcast') {
    emitter.emit(msg.event, msg.payload)
  }

  if (msg.event == 'tells/receive') {
    emitter.emit(msg.event, msg.payload)
  }

  if (msg.event == 'players/status') {
    let game = games.find(g => g.game == msg.payload.game)
    if (game) {
      game.players = msg.payload.players
      game.supports = msg.payload.supports
    } else {
      games.push(msg.payload)
    }
  }

  if (msg.event == 'players/sign-in' && msg.payload.game) {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      game = await send('players/status', {game: msg.payload.game})
      games.push(game.payload)
      return
    }
    game.players.push(msg.payload.name)
  }

  if (msg.event == 'players/sign-out' && msg.payload.game) {
    let game = games.find(g => g.game == msg.payload.game)
    if (!game) {
      game = await send('players/status', {game: msg.payload.game})
      games.push(game.payload)
      return
    }
    game.players = game.players.filter(n => n != msg.payload.name)
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
  init, connect, close, send, games, isAlive, addPlayer, removePlayer, findPlayer
}