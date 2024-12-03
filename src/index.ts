import type { CangjieItem, ListType } from './types'
import fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { defineExtension } from 'reactive-vscode'
import * as tar from 'tar'
import { commands, extensions, Uri } from 'vscode'
import { logger } from './utils'

const host = 'https://cangjie-lang.cn'

const { activate, deactivate } = defineExtension(async () => {
  const isInstalled = isExtensionInstalled('ide-innovation-lab.cangjie')
  if (isInstalled) {
    logger.info('Cangjie Plugin已安装')
    return
  }
  const Plugin = await getLatestCangjiePlugin()
  if (!Plugin) {
    logger.error('获取Cangjie Plugin失败')
    return
  }
  const url = `${host}${Plugin.url}`
  const name = Plugin.name
  const isExist = await isExistFile(name)
  const filePath = path.join(os.tmpdir(), name)
  if (isExist) {
    logger.info('文件已存在', name)
  } else {
    try {
      await downloadCangjie(url, name)
    } catch (error) {
      logger.error('下载失败', error)
      return
    }
  }
  try {
    await unzip(filePath)
  } catch (error) {
    logger.error('解压失败', error)
    return
  }
  const vsixPath = await getVSIXpath(filePath)
  try {
    const result = await installVSIX(vsixPath)
    logger.info(result)
  } catch (error) {
    logger.error('安装失败', error)
  }
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

async function downloadCangjie(url: string, name: string) {
  const tempDir = os.tmpdir()
  const filePath = path.join(tempDir, name)
  const response = await axios({
    url,
    responseType: 'stream',
    method: 'GET',
  })
  return new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(filePath)
    response.data.pipe(writer)
    writer.on('finish', () => {
      resolve()
    })
    writer.on('error', (err) => {
      reject(err)
    })
  })
}

async function unzip(filePath: string) {
  const folderPath = path.dirname(filePath)
  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(zlib.createGunzip())
      .pipe(tar.extract({ cwd: folderPath }))
      .on('finish', () => {
        resolve()
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

async function getVSIXpath(filePath: string) {
  const dir = filePath.replace('.tar.gz', '')
  const vsixPath = path.join(dir, fs.readdirSync(dir).find(it => it.endsWith('.vsix')) ?? '')
  return vsixPath
}

function isExtensionInstalled(extensionId: string) {
  const extension = extensions.getExtension(extensionId)
  return extension !== undefined
}

async function isExistFile(name: string) {
  const tempDir = os.tmpdir()
  const filePath = path.join(tempDir, name)
  return fs.existsSync(filePath)
}

export { activate, deactivate }
