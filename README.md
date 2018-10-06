# gossiphaus
Integration for the [gossip MUD protocol](https://gossip.haus/), a scrappy start-up inter-MUD communication protocol.

## Installation
`npm install gossiphaus`

## Debugging
Run with `DEBUG=gossiphaus` to see debug messages:

`$ DEBUG=gossiphaus node example.js`

## Example
```javascript
const gossip = require('../index')

run()

async function run() {
  try {
    // initialize with a configuration object.  your client_id and
    // client_secret are the minimum required parameters.
    let emitter = gossip.init({
      client_id: '12345678-1234-1234-1234-123456789abc',
      client_secret: '12345678-1234-1234-1234-123456789abc'
    })

    // catch asynchronous errors
    emitter.on('error', (err) => {
      console.log(err.stack)
    })

    // handle channel broadcasts
    emitter.on('channels/broadcast', (payload) => {
      console.log(payload)
    })

    // handle tells
    emitter.on('tells/receive', (payload) => {
      console.log(payload)
    })

    // connect to gossip and retrieve current game status
    await gossip.connect()

    // an array of other games connected to the gossip network with their
    // currently authenticated players
    console.log(gossip.games)  

    // notify gossip of a new player authenticated into your game
    let result = await gossip.addPlayer('SomePlayer')

    // subscribe your game to the 'secrets' channel
    result = await gossip.send('channels/subscribe', {
      channel: 'secrets'
    })

    // send a message to the 'secrets' channel
    result = await gossip.send('channels/send', {
      channel: 'secrets',
      name: 'SomePlayer',
      message: 'shhh'
    })

    // unsubscribe from the 'secrets' channel
    result = await gossip.send('channels/unsubscribe', {
      channel: 'secrets'
    })

    // returns {name: 'SomeOtherPlayer', game: 'SomeGame'} if that remote
    // player identifier is currently signed in on the remote game
    result = gossip.findPlayer('someotherplayer@somegame')

    // send a tell to a remote user
    result = await gossip.send('tells/send', {
      from_name: 'SomePlayer',
      to_game: 'SomeGame',
      to_name: 'SomeOtherPlayer',
      sent_at: new Date(),
      message: 'test'
    })

    // true
    console.log('isAlive: ' + gossip.isAlive())

    // notify gossip of a new player logged out of your game
    result = await gossip.removePlayer('SomePlayer')

    // forcibly close the connection
    gossip.close()

    // false
    console.log('isAlive: ' + gossip.isAlive())

  } catch (err) {
    console.log(err.stack)
  }
}
```

## API

### gossiphaus.init(config)
Initializes gossiphaus configuration.  Returns an event emitter object that will report asynchronous errors.  You should listen for the `error` event of this emitter object to catch asynchronous errors (ie. socket unexpectedly closed, reconnection failures).

* `config.client_id` {string} Your game's gossip client_id (**required**)
* `config.client_secret` {string} Your game's gossip client_secret (**required**)
* `config.statusWait` {Number} How long to wait and collect status messages on connect before resolving (in ms), default: **100**
* `config.reconnectIntervalTime` {Number} How long to wait in between reconnection attempts (in ms), default: **5000**
* `config.url` {string} gossip websocket url, default: **wss://gossip.haus/socket**
* `config.supports` {Array.<string>} Supported methods, default: **['channels', 'players', 'tells']**
* `config.channels` {Array.<string>} Channels to subscribe to, default: **['testing', 'gossip']**
* `config.version` {string} API version number to use, default not set
* `config.user_agent` {string} Game user agent, default not set

### gossiphaus.connect()
Connects to gossip, authenticates, and gets the status of current remotely connected games.  Returns a promise that resolves after `config.statusWait`.  The delay allows remote game status to accumulate and be available when the promise resolves.

### gossiphaus.close()
Closes the connection with gossip.  Connection can be re-established with `gossiphaus.connect()`.

### gossiphaus.send(event, payload, ref = true)
Sends an event to gossip.  See [the documentation](https://gossip.haus/docs) for information on the messages that can be sent.  Returns a promise that resolves with the acknowledgement packet.

* `event` {string} The gossip event name (**required**)
* `payload` {Object} The gossip event payload object (**required**)
* `ref` {boolean} If a ref id should be generated with this request, default: **true**

### gossiphaus.addPlayer(name)
Adds a player to your local game and informs the gossip network.  This should be called when a user logs in to your game.  You should use this method instead of calling `send('players/sign-in')` directly so that `heartbeat` responses have an up-to-date player list.

* `name` {string} The player's name (**required**)

### gossiphaus.removePlayer(name)
Removes a player from your local game and informs the gossip network.  This should be called when a user logs out of your game.  You should use this method instead of calling `send('players/sign-out')` directly so that `heartbeat` responses have an up-to-date player list.

* `name` {string} The player's name (**required**)

### gossiphaus.findPlayer(rpi)
Verifies that a remote player identifier (ie. someplayer@somegame) is logged in.  Case-insensitive
but returns the proper capitalization.  Useful when targeting remote players (ie. a remote tell command).  Returns an object of the form {name: 'SomePlayer', game: 'SomeGame'}.

* `rpi` {string} The remote player identifier, ie. someplayer@somegame (**required**)

### gossiphaus.isAlive()
Returns `true` if we are connected and authenticated to gossip and ready to send messages.

### gossiphaus.games
An array of remote game objects.  This object will be initialized as part of the `connect()` method and will be kept in sync when remote `players/sign-in` and `players/sign-out` messages are received.  The `config.statusWait` parameter controls how long to wait for this object to be populated.
