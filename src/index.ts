import type { ExtensionContext } from 'vscode'
import type { CangjieItem, ListType } from './types'
import fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { defineExtension } from 'reactive-vscode'
import * as tar from 'tar'
import { commands, Uri } from 'vscode'
import { logger } from './utils'

const host = 'https://cangjie-lang.cn'

const { activate, deactivate } = defineExtension(async (context: ExtensionContext) => {
  logger.info('Cangjie activated', context.globalStorageUri)
  const Plugin = await getLatestCangjiePlugin()
  if (!Plugin) {
    logger.error('获取Cangjie Plugin失败')
    return
  }
  const url = `${host}${Plugin.url}`
  const name = Plugin.name
  const filePath = await downloadCangjie(url, name)
  const folderPath = path.dirname(filePath)
  fs.createReadStream(filePath)
    .pipe(zlib.createGunzip())
    .pipe(tar.extract({ cwd: folderPath }))
    .on('finish', () => {
      console.log('解压完成')
    })
    .on('error', (err) => {
      console.error('解压失败:', err)
    })
  // try {
  //   const result = await installVSIX(filePath)
  //   logger.info(result)
  // } catch (error) {
  //   logger.error(error)
  // }
})

async function getLatestCangjiePlugin(): Promise<CangjieItem | undefined> {
  const download_text = await axios.get(`${host}/download`)
  const $download_text = cheerio.load(download_text.data)
  const href = $download_text('.download-version-item-btn').filter((_, el) => $download_text(el).attr('href') !== 'javascript:;').first().attr('href')
  const version_text = await axios.get(`${host}${href}`)
  const $version_text = cheerio.load(version_text.data)
  const script = $version_text('script')
    .filter((_, el) => $download_text(el).attr('type') === 'text/javascript')
    .filter((_, el) => /version\..+\.js$/.test($download_text(el).attr('src') ?? ''))
    .first()
    .attr('src')
  if (!script) {
    return Promise.reject(new Error('获取script失败'))
  }
  const js_text = await axios.get(script)
  const str = 'listTab:function(){return'
  const fun_index = (js_text.data as string).indexOf(str)
  if (fun_index === -1) {
    return Promise.reject(new Error('获取listTab失败'))
  }
  let result = ''
  const stack = []
  for (let i = fun_index + str.length; i < js_text.data.length; i++) {
    if (js_text.data[i] === '[') {
      stack.push('[')
    } else if (js_text.data[i] === ']') {
      stack.pop()
    }
    result += js_text.data[i]
    if (stack.length === 0) {
      break
    }
  }
  const code = result.replaceAll(/this\.\$t\((.*?)\)/g, '$1')
  // eslint-disable-next-line no-eval
  const data: ListType = (0, eval)(code)
  const plugins = data.find(it => it.list.find(i => i.name === 'VScode Plugin'))
  const Plugin = plugins?.list[0]?.list[0]
  return Plugin
}

async function installVSIX(uri: string) {
  await commands.executeCommand('workbench.extensions.installExtension', Uri.file(uri))
}

async function downloadCangjie(url: string, name: string): Promise<string> {
  const tempDir = os.tmpdir()
  const filePath = path.join(tempDir, name)
  const response = await axios({
    url,
    responseType: 'stream',
    method: 'GET',
  })
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath)
    response.data.pipe(writer)
    writer.on('finish', () => {
      resolve(filePath)
    })
    writer.on('error', (err) => {
      reject(err)
    })
  })
}

export { activate, deactivate }
