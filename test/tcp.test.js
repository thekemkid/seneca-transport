'use strict'

var Assert = require('assert')
var Fs = require('fs')
var Code = require('code')
var Lab = require('lab')
var Tcp = require('../lib/tcp')
var TransportUtil = require('../lib/transport-utils')
var ChildProcess = require('child_process')
var Path = require('path')

var CreateInstance = require('./utils/createInstance')
var CreateClient = require('./utils/createClient')

var lab = exports.lab = Lab.script()
var describe = lab.describe
var it = lab.it
var expect = Code.expect

describe('Specific tcp', function () {
  it('client and listen work as expected', function (fin) {
    var instance = CreateInstance()

    instance.add('c:1', function (args, done) {
      done(null, { s: '1-' + args.d })
    })

    instance.listen({type: 'tcp', port: 20102})

    instance.ready(function () {
      var seneca = this
      var count = 0

      function check () {
        count++

        if (count === 3) {
          seneca.close(fin)
        }
      }

      CreateClient('tcp', 20102, check, 'cln0')
      CreateClient('tcp', 20102, check, 'cln1')
      CreateClient('tcp', 20102, check, 'cln2')
    })
  })

  it('error-passing-tcp', function (fin) {
    CreateInstance()
      .add('a:1', function (args, done) {
        done(new Error('bad-wire'))
      })
      .listen({type: 'tcp', port: 40404})

    CreateInstance()
      .client({type: 'tcp', port: 40404})
      .act('a:1', function (err, out) {
        Assert.equal('seneca: Action a:1 failed: bad-wire.', err.message)
        fin()
      })
  })

  it('can listen on ephemeral port', function (done) {
    var seneca = CreateInstance()

    var settings = {tcp: {port: 0, host: 'localhost'}}


    var transportUtil = new TransportUtil({
      callmap: {},
      seneca: seneca,
      options: settings
    })

    var tcp = Tcp.listen(settings, transportUtil)

    expect(typeof tcp).to.equal('function')

    tcp.call(seneca, { type: 'tcp' }, function (err) {
      expect(err).to.not.exist()
      done()
    })
  })

  it('can listen on unix path', {skip: /win/.test(process.platform)}, function (done) {
    var sock = '/tmp/seneca.sock'

    if (Fs.existsSync(sock)) {
      Fs.unlinkSync(sock)
    }

    var seneca = CreateInstance()
    var settings = {tcp: {path: sock}}

    var transportUtil = new TransportUtil({
      callmap: {},
      seneca: seneca,
      options: settings
    })

    var tcp = Tcp.listen(settings, transportUtil)
    expect(typeof tcp).to.equal('function')

    tcp.call(seneca, { type: 'tcp' }, function (err) {
      expect(err).to.not.exist()
      done()
    })
  })

  it('will retry listening a specified number of times', function (done) {
    var seneca1 = CreateInstance()
    var seneca2 = CreateInstance()

    var settings1 = {tcp: {port: 0}}

    var transportUtil1 = new TransportUtil({
      callmap: {},
      seneca: seneca1,
      options: settings1
    })

    var tcp1 = Tcp.listen(settings1, transportUtil1)
    expect(typeof tcp1).to.equal('function')

    tcp1.call(seneca1, { type: 'tcp' }, function (err, address) {
      expect(err).to.not.exist()

      var settings2 = {
        tcp: {
          port: address.port,
          max_listen_attempts: 10,
          attempt_delay: 10
        }
      }

      var transportUtil2 = new TransportUtil({
        callmap: {},
        seneca: seneca2,
        options: settings2
      })
      var tcp2 = Tcp.listen(settings2, transportUtil2)
      expect(typeof tcp2).to.equal('function')

      setTimeout(function () {
        seneca1.close()
      }, 20)

      tcp2.call(seneca2, { type: 'tcp' }, function (err, address) {
        expect(err).to.not.exist()
        done()
      })
    })
  })

  it('defaults to 127.0.0.1 for connections', function (done) {
    var seneca = CreateInstance()

    var settings = {
      tcp: {
        port: 0
      }
    }

    var transportUtil = new TransportUtil({
      callmap: {},
      seneca: seneca,
      options: settings
    })

    var server = Tcp.listen(settings, transportUtil)
    expect(typeof server).to.equal('function')

    server.call(seneca, { type: 'tcp' }, function (err, address) {
      expect(err).to.not.exist()

      settings.tcp.port = address.port
      var client = Tcp.client(settings, transportUtil)
      expect(typeof client).to.equal('function')
      client.call(seneca, { type: 'tcp' }, function (err) {
        expect(err).to.not.exist()
        done()
      })
    })
  })

  it('handles reconnects', { timeout: 10000 }, function (done) {
    var serverPath = Path.join(__dirname, 'reconnect', 'server.js')
    var clientPath = Path.join(__dirname, 'reconnect', 'client.js')

    var server = ChildProcess.fork(serverPath)
    var client = ChildProcess.fork(clientPath)
    var actCallCount = 0
    var actedCount = 0
    var setupClient = false

    var handleServerMsg = function (msg) {
      process.stdout.write('got SrvMsg ' + JSON.stringify(msg, null, 2) + '\n')
      if (!setupClient && msg.port) {
        process.stdout.write('setting up client\n')
        client.send({ port: msg.port })
        setupClient = true
      }
      else if (msg.gotActCall) {
        process.stdout.write('srv got actcall\n')
        actCallCount++
      }
    }

    var handleExit = function (code, signal) {
      expect(code).to.equal(null)
      expect(signal).to.equal('SIGKILL')
    }

    server.on('message', handleServerMsg)
    client.on('message', function (msg) {
      process.stdout.write('got CltMsg ' + JSON.stringify(msg, null, 2) + '\n')
      if (!msg.acted) return
      actedCount++
    })

    server.on('exit', handleExit)
    client.on('exit', handleExit)

    setTimeout(function () {
      server.kill('SIGKILL')
      setTimeout(function () {
        process.stdout.write('srv restart\n')
        server = ChildProcess.fork(serverPath)
        server.on('message', handleServerMsg)
        server.on('exit', handleExit)
      }, 500)
    }, 4000)

    setTimeout(function () {
      server.kill('SIGKILL')
      client.kill('SIGKILL')
      expect(actCallCount).to.equal(1)
      expect(actedCount).to.equal(1)
      done()
    }, 8000)
  })
})
