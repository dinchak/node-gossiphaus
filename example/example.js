const gossiphaus = require('../index')

run()

async function run() {
  try {
    // initialize with a configuration object.  your client_id and
    // client_secret are the minimum required parameters.
    let emitter = gossiphaus.init({
      client_id: '12345678-1234-1234-1234-123456789abc',
      client_secret: '12345678-1234-1234-1234-123456789abc'
    })

    // catch asynchronous errors
    emitter.on('error', (err) => {
      console.log(err.stack)
    })

    // connect to gossiphaus and retrieve current game status
    await gossiphaus.connect()

    // an array of other games connected to the gossip network with their
    // currently authenticated players
    console.log(gossiphaus.games)  

    // notify gossip of a new player authenticated into your game
    let result = await gossiphaus.addPlayer('SomePlayer')

    // subscribe your game to the 'secrets' channel
    result = await gossiphaus.send('channels/subscribe', {
      channel: 'secrets'
    })

    // send a message to the 'secrets' channel
    result = await gossiphaus.send('channels/send', {
      channel: 'secrets',
      name: 'SomePlayer',
      message: 'shhh'
    })

    // unsubscribe from the 'secrets' channel
    result = await gossiphaus.send('channels/unsubscribe', {
      channel: 'secrets'
    })

    // send a tell to a remote user
    result = await gossiphaus.send('tells/send', {
      from_name: 'SomePlayer',
      to_game: 'SomeGame',
      to_name: 'SomeOtherPlayer',
      sent_at: new Date(),
      message: 'test'
    })

    // notify gossip of a new player logged out of your game
    result = await gossiphaus.removePlayer('SomePlayer')

    gossiphaus.close()

  } catch (err) {
    console.log(err.stack)
  }
}
