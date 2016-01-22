'use strict'

var minimist = require('minimist')
var net = require('net')
var tentacoli = require('../')
var pump = require('pump')
var server = net.createServer(handle)
var count = 0
var port

var argv = minimist(process.argv.slice(2), {
  boolean: 'child',
  default: {
    child: true,
    port: 3000,
    host: 'localhost'
  }
})

if (argv.child) {
  port = 0
} else {
  port = 3000
}

function handle (sock) {
  var receiver = tentacoli()
  pump(sock, receiver, sock)
  receiver.on('request', function request (req, reply) {
    count++
    reply(null, req)
  })
}

server.listen(port, function (err) {
  if (err) throw err

  if (argv.child) {
    process.send(server.address())
  } else {
    console.error('listening on', server.address().port)
  }
})

process.on('disconnect', function () {
  process.exit(0)
})

var signal = 'SIGINT'

// Cleanly shut down process on SIGTERM to ensure that perf-<pid>.map gets flushed
process.on(signal, onSignal)

function onSignal () {
  console.error('count', count)
  // IMPORTANT to log on stderr, to not clutter stdout which is purely for data, i.e. dtrace stacks
  console.error('Caught', signal, ', shutting down.')
  server.close()
  process.exit(0)
}
