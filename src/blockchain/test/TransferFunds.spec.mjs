//import { MethodCounter, TraceLog } from '../src/common/proxies'
import Blockchain from '../src/domain/Blockchain.mjs'
import JSLCoinService from '../src/domain/service/JSLCoinService.mjs'
import Key from '../src/domain/value/Key.mjs'
import Money from '../src/domain/value/Money.mjs'
import Transaction from '../src/domain/Transaction.mjs'
import Wallet from '../src/domain/Wallet.mjs'
import chai from 'chai'
import { compose } from '../src/lib/fp/combinators.mjs'
import fs from 'fs'
import path from 'path'

const { assert } = chai
const USE_PROXIES = true

async function makeLedger() {
  const instance = new Blockchain()
  if (USE_PROXIES) {
    const { MethodCounter, TraceLog } = await import('../src/common/proxies.mjs')
    const applyProxies = compose(
      TraceLog,
      MethodCounter('lookUp', 'validate')
    )
    return applyProxies(instance)
  }
  return instance
}

function makeLedgerP() {
  const instance = new Blockchain()
  if (USE_PROXIES) {
    return import('../src/common/proxies.mjs').then(({ MethodCounter, TraceLog }) => {
      const applyProxies = compose(
        TraceLog,
        MethodCounter('lookUp', 'validate')
      )
      return applyProxies(instance)
    })
  }
  return Promise.resolve(instance)
}

describe('Transfer Funds Test suite', () => {
  it('Should transfer funds from one wallet to the next', async () => {
    // Luke's digital wallet
    const luke = new Wallet(Key('luke-public.pem'), Key('luke-private.pem'))

    // Ana's digital wallet
    const ana = new Wallet(Key('ana-public.pem'), Key('ana-private.pem'))

    // Some miner's digital wallet
    const miner = new Wallet(Key('miner-public.pem'), Key('miner-private.pem'))

    const first = new Transaction(null, miner.address, (100).jsl(), 'First transaction')
    first.signature = first.sign(miner.privateKey)

    const ledger = await makeLedgerP()

    ledger.addPendingTransaction(first)

    const service = JSLCoinService(ledger)

    // Mine some initial block, after mining the reward is BTC 100 for wa
    await service.minePendingTransactions(miner.address, 2)

    const balance = miner.balance(ledger)

    // Balance is zero because the reward has not been mined in the blockchain
    console.log('Miner starts out with', balance)
    assert.isOk(balance.equals((100).jsl()))

    // Mine the next block to retrieve reward
    await service.minePendingTransactions(miner.address, 2)

    service.transferFunds(miner, luke, Money('jsl', 20), 'Transfer 20 JSL to Luke')
    await service.minePendingTransactions(miner.address, 2)

    let lukeBalance = luke.balance(ledger)
    console.log("Luke's balance is", lukeBalance)
    assert.isOk(lukeBalance.equals((20).jsl()))

    let minerBalance = miner.balance(ledger)
    assert.isOk(minerBalance.equals((104.6).jsl()), `Miner's balance is ${minerBalance}`)

    // Transfer funds between Luke and Ana
    service.transferFunds(luke, ana, Money('jsl', 10), 'Transfer ₿20 from Luke to Ana')
    await service.minePendingTransactions(miner.address, 2)

    let anaBalance = service.calculateBalanceOfWallet(ana.address)

    lukeBalance = service.calculateBalanceOfWallet(luke.address)

    assert.isOk(
      anaBalance.equals((10).jsl()),
      `Ana's balance should be ₿10.00 and was ${anaBalance}`
    )
    assert.isOk(
      lukeBalance.equals((9.8).jsl()),
      `Luke's balance should be ₿9.8 and was ${lukeBalance}`
    )

    // Both wallets currently have about 10 BTC
    service.transferFunds(luke, ana, (5).jsl(), 'Transfer ₿5 from Luke to Ana')
    await service.minePendingTransactions(miner.address, 2)

    anaBalance = service.calculateBalanceOfWallet(ana.address)

    lukeBalance = service.calculateBalanceOfWallet(luke.address)

    // Assert Ana has BTC 70 and Luke has BTC 30
    assert.isOk(
      anaBalance.equals((15).jsl()),
      `Ana's balance should be ₿15.00 and was ${anaBalance}`
    )
    assert.isOk(
      lukeBalance.equals((4.7).jsl()),
      `Luke's balance should be ₿4.7 and was ${lukeBalance}`
    )

    // Ana sends Luke some BTC 5, then Luke returns 3
    service.transferFunds(ana, luke, Money('jsl', 5), 'Transfer ₿5 from Ana back to Luke')
    service.transferFunds(luke, ana, Money('jsl', 3), 'Transfer ₿3 from Luke back to Ana')
    await service.minePendingTransactions(miner.address, 2)

    anaBalance = service.calculateBalanceOfWallet(ana.address)

    lukeBalance = service.calculateBalanceOfWallet(luke.address)

    // Assert Ana has BTC 80 and Luke has BTC 20
    assert.isOk(
      anaBalance.equals((12.9).jsl()),
      `Ana's balance should be ₿17.00 and was ${anaBalance}`
    )
    assert.isOk(
      lukeBalance.equals((6.64).jsl()),
      `Luke's balance should be ₿6.64 and was ${lukeBalance}`
    )

    // No funds left to transfer!
    assert.throws(
      () => service.transferFunds(luke, ana, (30).jsl(), 'Transfer ₿30 from Luke to Ana'),
      RangeError
    )

    minerBalance = service.calculateBalanceOfWallet(miner.address)
    assert.isOk(minerBalance.equals((142.1).jsl()), `Miner's balance is ${minerBalance}`)

    // Print ledger
    // TODO:  Use ES7 String padding to format this output
    // console.log(ledger.map(x => x.inspect()))

    console.table(
      [...ledger].map(block => ({
        genesis: block.isGenesis() ? '\u2714' : false,
        previousHash: block.previousHash.valueOf(),
        hash: block.hash.valueOf(),
        count: block.data.length
      }))
    )

    const isLedgerValid = ledger.validate()
    assert.isOk(isLedgerValid.isSuccess, 'Is ledger valid?')
    if (USE_PROXIES) {
      assert.isAbove(ledger.lookUp.invocations, 0)
      assert.isAbove(ledger.validate.invocations, 0)
      console.log('Number of lookUps made: ', ledger.lookUp.invocations)
      console.log('Number of ledger validations made: ', ledger.validate.invocations)
    }

    const file = path.join(process.cwd(), 'test', 'test-run.txt')
    const rawLedger = service.serializeLedger(file)
    try {
      fs.writeFileSync(file, rawLedger)
    }
    finally {
      fs.unlink(file, err => {
        if (err) throw err
        console.log(`${file} was deleted`)
      })
    }
  })
})