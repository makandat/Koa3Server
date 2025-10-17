/* Koa3 Application */
'use strict'
import Koa from 'koa'
import koaBodyImport from 'koa-body'
import session from 'koa-session'
import Router from '@koa/router'
import KoaLogger from 'koa-logger'
import serve from 'koa-static'
import views from 'koa-views'
import path from 'path'
import fs from 'fs'
import { format } from 'date-fns'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

// __dirname を取得するヘルパー関数 (CJS では自動的に提供されるが、ESM では提供されないため)
function getAppDir() {
  // 現在のモジュールのURL (例: file:///path/to/my-module.mjs)
  const moduleUrl = import.meta.url;
  // URLをファイルパスに変換
  const __filename = fileURLToPath(moduleUrl)
  // ファイルパスからディレクトリパスを取得
  const __dirname = path.dirname(__filename)
  return __dirname
}

// 場所リストの読み込み
async function loadLocationList() {
  const LLIST = "./folders.txt"
  const s = await fs.promises.readFile(LLIST, 'utf-8')
  const ss = s.split("\n")
  const items = []
  for (const f of ss) {
    if (f.length > 0) {
      items.push(f)
    }
  }
  return items
}

// 場所の内容リストを取得
async function getLocationList(folder="/") {
  let dirents, stat, path1, filedate, sizekb, modeoct
  try {
    dirents = await fs.promises.readdir(folder, { withFileTypes: true})
  }
  catch (err) {
    return []
  }
  const list = []
  for (const ent of dirents) {
    path1 = path.join(folder, ent.name)
    try {
      stat = await fs.promises.stat(path1)
      filedate = format(stat.mtime, 'yyyy-MM-dd HH:mm:ss')
      sizekb = Math.ceil(stat.size / 1024) + "KB"
      modeoct = stat.mode.toString(8)
    }
    catch (err) {
      filedate = 'Unknown'
      sizekb = "Unknown"
      modeoct = "0000000"    
    }
    if (ent.name.startsWith('.') == false) {
      if (ent.isDirectory()) {
        list.push([ent.name + '/', filedate, sizekb, modeoct])
      }
      else if (ent.isSymbolicLink()) {
        const linkPath = path.join(folder, ent.name)
        const target = await fs.promises.readlink(linkPath)
        list.push([ent.name + '=' + target, filedate, sizekb, modeoct])
      }
      else {
        list.push([ent.name, filedate, sizekb, modeoct])
      }
    }
  }
  return list
}

// package.json の項目を取得する。
function getPackageJsonItem(key) {
  const __dirname = getAppDir()
  const packageJsonPath = path.join(__dirname, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  return packageJson[key] || ''
}

// HTMLエスケープ関数
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Koa アプリケーションの初期化
const UPLOAD_DIR = './uploads'
const app = new Koa()
app.keys = ['koa3_server_key']
app.use(session(app))
const router = new Router()
const PORT = process.env.PORT || 3230
app.use(KoaLogger())
// テンプレートエンジンの設定
const __dirname = getAppDir()
app.use(views(__dirname + '/views', { extension: 'pug' }));
app.use(views(path.join(__dirname, '/views'), {
  map: { pug: 'pug' }
}))
// ファイルアップロードの準備
const koaBody = koaBodyImport.default || koaBodyImport
app.use(koaBody({multipart: true, formidable: { uploadDir: UPLOAD_DIR, keepExtensions: true}}))
// 前セッションでの中間ファイルの削除
fs.readdir(UPLOAD_DIR, (err, files) => {
  for (const f of files) {
    const p = path.join(UPLOAD_DIR, f)
    fs.unlinkSync(p)
  }
})


// ルートハンドラ
router.get('/', async (ctx) => {
  let location = ctx.session.location
  if (fs.existsSync(location) == false)
    location = "/"
  if (process.platform == 'win32' && location == '/')
    location = 'C:/'
  location = location.replaceAll('//', '/').replaceAll('\\', '/')
  const version = getPackageJsonItem('version') || '1.0.0'
  const title = (getPackageJsonItem('description') || 'Koa3 with Pug') + ' (Version ' + version + ')'
  const locations = await loadLocationList()
  const content = await getLocationList(location)
  await ctx.render('index', {
    title: title,
    place: location,
    locations: locations,
    content: content
  })
  ctx.session.location = location
})

// トップフォルダを設定する。
router.get('/folder', async ctx => {
  const path = ctx.query.path
  ctx.session.location = path
  ctx.redirect('/')
})

// フォルダリストの項目がクリックされたとき
router.get('/move', async ctx => {
  const loc = ctx.query.location
  if (loc != '..')
    ctx.session.location = path.join(ctx.session.location, loc)
  else {
    if (ctx.session.location != '/')
      ctx.session.location = path.dirname(ctx.session.location)
  }
  ctx.redirect('/')
})

// ファイルアップロード
router.post('/file_upload', async ctx => {
  const files = ctx.request.files?.files
  const dest = ctx.request.body.dest
  if (!files) {
    ctx.body = 'ファイルがありません'
    return
  }
  // ファイル保存
  const fileArray = Array.isArray(files) ? files : [files]
  for (const file of fileArray) {
    const destPath = path.join(dest, file.originalFilename)
    try {
      await fs.promises.copyFile(file.filepath, destPath)
      ctx.redirect('/')
    }
    catch (err) {
      await ctx.render('/result', {title:'アップロード失敗', message: 'ファイルアップロードが失敗しました。' + err.message})
    }
  }
})

// ファイルをダウンロード
router.get('/download', async ctx => {
  const download_path = ctx.request.query.path
  ctx.attachment(path.basename(download_path))
  ctx.body = fs.createReadStream(download_path)
})

// フォルダ作成
router.get('/mkdir', async ctx => {
  await ctx.render('mkdir', {message:''})
})
router.post('/mkdir', async ctx => {
  const folder = ctx.request.body.folder
  try {
    fs.mkdirSync(folder)
    await ctx.render('mkdir', {'message':`新しいフォルダが作成されました。`})
  }
  catch (err) {
    await ctx.render('mkdir', {'message':`エラー： フォルダ の作成に失敗しました。${err.message}`})
  }
})

// ファイルコピー
router.get('/copy', async ctx => {
  await ctx.render('copy', {message:''})
})
router.post('/copy', async ctx => {
  try {
    const sourcefile = ctx.request.body.sourcefile
    let destfile = ctx.request.body.destfile
    const status = fs.statSync(destfile)
    if (status.isDirectory()) {
      const filename = path.basename(sourcefile)
      destfile = path.join(destfile, filename)
    }
    fs.copyFileSync(sourcefile, destfile)
    await ctx.render('copy', {'message':'コピーが完了しました。'})
  }
  catch (err) {
    await ctx.render('copy', {'message':`エラー： コピーに失敗しました。${err.message}`})
  }
})

// ファイル名の変更
router.get('/rename', async ctx => {
  await ctx.render('rename', {message:''})
})
router.post('/rename', async ctx => {
  try {
    const sourcefile = ctx.request.body.sourcefile
    const destfile = ctx.request.body.destfile
    fs.renameSync(sourcefile, destfile)
    await ctx.render('rename', {'message':'名前の変更が完了しました。'})
  }
  catch (err) {
    await ctx.render('copy', {'message':`エラー： 名前の変更に失敗しました。${err.message}`})
  }
})

// ファイル削除
router.get('/delete', async ctx => {
  await ctx.render('delete', {message:''})
})
router.post('/delete', async ctx => {
  try {
    const file = ctx.request.body.file
    fs.unlinkSync(file)
    await ctx.render('delete', {'message':'ファイルが削除されました。'})
  }
  catch (err) {
    await ctx.render('copy', {'message':`エラー： ファイルの削除に失敗しました。${err.message}`})
  }
})

// フォルダ削除(Linux)
router.get('/removedir', async ctx => {
  let message = ''
  if (process.platform == 'win32')
    message = 'これは Linux のみの機能です。'
  await ctx.render('removedir', {message: message})
})
router.post('/removedir', async ctx => {
  const folder = ctx.request.body.folder
  try {
    // rf コマンドで削除
    const result = spawnSync('rm', ['-rf', folder])
    if (result.status !== 0) {
      throw new Error(result.stderr.toString())
    }
    await ctx.render('removedir', {'message': 'フォルダが削除されました。'})
  }
  catch (err) {
    await ctx.render('removedir', {'message':`エラー： フォルダの削除に失敗しました。${err.message}`})
  }  
})

// タールボールの作成
router.get('/tarball', async ctx => {
  await ctx.render('tarball', {message:''})
})
router.post('/tarball', async ctx => {
  const folder = ctx.request.body.folder
  const targz = ctx.request.body.targz
  try {
    // tarコマンドで圧縮
    const result = spawnSync('tar', ['-czf', targz, folder])
    if (result.status !== 0) {
      throw new Error(result.stderr.toString())
    }
    await ctx.render('tarball', {'message':`.tar.gz ファイルが作成されました: ${targz}`})
  }
  catch (err) {
    await ctx.render('tarball', {'message':`エラー： tar.gz 作成に失敗しました。${err.message}`})
  }  
})

// タールボール解凍
router.get('/inflate', async ctx => {
  await ctx.render('inflate', {message: ''})
})
router.post('/inflate', async ctx => {
  const targz = ctx.request.body.targz
  let target = ctx.request.body.target
  if (target == '') {
    target = path.dirname(targz)
  }
  try {
    // tarコマンドで解凍
    const result = spawnSync('tar', ['-xf', targz, '-C', target])
    if (result.status !== 0) {
      throw new Error(result.stderr.toString())
    }
    await ctx.render('inflate', {'message':'.tar.gz ファイルが解凍されました。'})
  }
  catch (err) {
    await ctx.render('inflate', {'message':`エラー： tar.gz 解凍に失敗しました。${err.message}`})
  }  
})

// 標準の場所の編集
router.get('/places', async ctx => {
  const content = fs.readFileSync('./folders.txt', 'utf-8')
  await ctx.render('folders', {message: '', content: content})
})
router.post('/places', async ctx => {
  const content = ctx.request.body.places
  try {
    fs.writeFileSync('./folders.txt', content, 'utf-8')
    await ctx.render('folders', {message: '標準の場所を編集しました。画面には反映されないのでリロードしてください。', content: content})    
  }
  catch (err) {
    await ctx.render('folders', {message: 'エラーを検出。' + err.message, content: content})
  }
})

// 結果を表示する。
router.get('/result', async ctx => {
  const title = ctx.request.query.title
  const message = ctx.request.query.message
  await ctx.render('/result', {title: title, message: message})
})

// テキストファイルの内容を返す。
router.get('/get_textfile', async ctx => {
  const file = ctx.request.query.file
  let content = await fs.promises.readFile(file, 'utf-8')
  ctx.type = 'text/plain'
  ctx.body = content
})

// アプリケーションにルートを適用する。
app.use(router.routes()).use(router.allowedMethods());

// 'public'ディレクトリ内のファイルを静的ファイルとして公開
app.use(serve(path.join(path.dirname("."), 'public')))

// サーバーの起動
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
