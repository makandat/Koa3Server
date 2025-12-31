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
import { spawnSync, execSync } from 'child_process'
import { chdir } from 'node:process'
import { globSync } from 'node:fs'

// 定数定義
const CWD = process.cwd()
const UPLOAD_DIR = CWD + '/uploads'
const FOLDERS = CWD + "/folders.txt"
const PORT = 3230

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
const app = new Koa()
app.keys = ['koa3_server_key']
app.use(session(app))
const router = new Router()
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
    await ctx.render('mkdir', {'message':`新しいフォルダ ${folder} が作成されました。`})
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
  await ctx.render('delete', {'title':'ファイルの削除', message:''})
})
router.post('/delete', async ctx => {
  try {
    const file = ctx.request.body.file
    const wildcard = ctx.request.body.wildcard == 'on' ? true : false
    if (wildcard) {
      // ワイルドカード対応
      const files = globSync(file)
      for (const f of files) {
        fs.unlinkSync(f)
      }
      await ctx.render('delete', {'title':'ファイルの削除', 'message':`${files.length} 個のファイルが削除されました。`})
      return
    }
    else {
      fs.unlinkSync(file)
      await ctx.render('delete', {'title':'ファイルの削除', 'message':file + ' が削除されました。'})
    }
  }
  catch (err) {
    await ctx.render('delete', {'title':'ファイルの削除', 'message':`エラー： ファイルの削除に失敗しました。${err.message}`})
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
  const content = fs.readFileSync(FOLDERS, 'utf-8')
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

// 複数ファイルのコピー
router.get('/copyfiles', async ctx => {
  await ctx.render('copyfiles', {'title':'複数ファイルのコピー', 'message':'', 'result':''})
})
router.post('/copyfiles', async ctx => {
  // 正規表現を使ってファイル検索
  async function re_find_files(dirPath, regex) {
    const filenames = await fs.promises.readdir(dirPath)
    const matchingFiles = filenames.filter(filename => 
        regex.test(filename)
      )
      return matchingFiles
  }
  // 条件に合ったパスを検索
  async function search_files(folder, search_text, pattern_type) {
    let flist = []
    switch (pattern_type) {
      case 'regexp': 
        const regex = new RegExp(search_text)
        const flist2 = await re_find_files(folder, regex)
        for (const f of flist2) {
          flist.push(path.join(folder, f))
        }
        break
      case 'wildcard':
        flist = globSync(folder + "/" + search_text)
        break
      default:  // file_list
        break
    }
    return flist
  }
  // ファイルコピーを実行する
  async function copy_files(paths, destination, write_type) {
    let cnt = 0
    switch (write_type) {
      case 'overwrite':  // 常に上書き
        for (const p of paths) {
          const filename = path.basename(p)
          const destpath = path.join(destination, filename)
          await fs.promises.copyFile(p, destpath)
          cnt++
        }
        break
      case 'skip_existing':  // 同じ名前のファイルがある場合は上書きしない
        for (const p of paths) { 
          const filename = path.basename(p)
          const destpath = path.join(destination, filename)
          if (fs.existsSync(destpath) == false) {
            await fs.promises.copyFile(p, destpath)
            cnt++
          }
        }
        break
      case 'check_date':  // 更新日時を比較して新しい場合のみ上書き
        for (const p of paths) {
          const filename = path.basename(p)
          const destpath = path.join(destination, filename)
          let copyFlag = true
          if (fs.existsSync(destpath)) {
            const srcStat = await fs.promises.stat(p)
            const destStat = await fs.promises.stat(destpath)
            if (srcStat.mtime <= destStat.mtime) {
              copyFlag = false
            }
          }
          if (copyFlag) {
            await fs.promises.copyFile(p, destpath)
            cnt++
          }
        }
        break
      default:
        break
    }
    return cnt
  }
  // 変数初期化
  let message = ''
  let files = ''
  // パラメータを取得
  const action_type = ctx.request.body.action_type
  const paths = ctx.request.body.paths
  const pattern_type = ctx.request.body.pattern_type
  const search_text = ctx.request.body.search_text
  const folder = ctx.request.body.folder
  const destination = ctx.request.body.destination
  const write_type = ctx.request.body.write_type
  // 送信ボタン種別による処理
  switch (action_type) {
    case 'copy':  // コピー
      if (paths == '') {
        await ctx.render('copyfiles', {'title':'複数ファイルのコピー', 'message':'エラー： ファイルリストが空欄です。', 'files':'', 'folder':folder, 'destination':destination})
        return 
      }
      const pathArray = paths.split('\n').map(p => p.trim()).filter(p => p.length > 0)
      const cnt = await copy_files(pathArray, destination, write_type)
      files = pathArray.join('\n')
      message = 'コピーされました。' + cnt + ' 個のファイル。'
      break
    case 'search':  // 検索
    if (search_text == '') {
        await ctx.render('copyfiles', {'title':'複数ファイルのコピー', 'message':'エラー： 検索条件が空欄です。', 'files':'', 'folder':folder, 'destination':destination})
        return 
      }
      const list = await search_files(folder, search_text, pattern_type)
      // テキストエリア更新
      if (list.length > 0) {
        for (const s of list) {
          files += s + '\n'
        }
      }
      else {
        if (paths.length == 0) {
          await ctx.render('copyfiles', {'title':'複数ファイルのコピー', 'message':'エラー： 検索結果が空です。', 'files':'', 'folder':folder, 'destination':destination, 'search_text':search_text})
          return 
        }
      }
      message = '検索されました。' + list.length + ' 個のファイル。'
      break
    default:
      break
  }
  await ctx.render('copyfiles', {'title':'複数ファイルのコピー', 'message':message, 'files':files, 'folder':folder, 'destination':destination, 'search_text':search_text})
})

// テキストファイルの編集
router.get('/edittext', async ctx => {
  await ctx.render('edittext', {'title':'テキストファイルの編集', 'message':'', 'path':'', 'content':''})
})
router.post('/edittext', async ctx => {
  const action_type = ctx.request.body.action_type
  const path = ctx.request.body.path
  if (path == '') {
    await ctx.render('edittext', {'title':'テキストファイルの編集', 'message':'エラー： ファイルのパス名が指定されていません。', 'path':'', 'content':''})
    return
  }
  let content = ctx.request.body.content
  let message = ''
  switch (action_type) {
    case 'open':  // ファイルを開く
      try {
        content = await fs.promises.readFile(path, 'utf-8')
        message = 'ファイルを読み込みました。'
      }
      catch (err) {
        message = "エラー： " + err.message
      }
      break
    case 'save':  // 上書き保存
      try {
        await fs.promises.writeFile(path, content, 'utf-8')
        message = 'ファイルに上書き保存しました。'
      }
      catch (err) {
        message = "エラー： " + err.message
      }
      break
    case 'save_as':  // 名前を付けて保存
      try {
        if (fs.existsSync(path) == false) {
          await fs.promises.writeFile(path, content, 'utf-8')
          message = 'ファイルに新規保存しました。'
        }
        else {
          message = "エラー： すでに同じ名前のファイルが存在します。"
        }
      }
      catch (err) {
        message = "エラー： " + err.message
      }
      break
    default:
      break
  }
  await ctx.render('edittext', {'title':'テキストファイルの編集', 'message':message, 'path':path, 'content':content})
})

// コマンド実行
router.get('/exec', async ctx => {
  await ctx.render('exec', {'title':'コマンド実行', 'message':'', 'result': '', 'command':'', 'place':''})
})
router.post('/exec', async ctx => {
  const command = ctx.request.body.command
  const place = ctx.request.body.place
  let message = ''
  let result = ''
  try {
    if (place != '') {
      chdir(place)
    }
    result = execSync(command).toString()
    message = 'コマンドが実行されました。'
  }
  catch (err)
  {
    message = 'エラー： ' + err.message
  }
  finally {
    await ctx.render('exec', {'title':'コマンド実行', 'message':message, 'command':command, 'place':place, 'result':result})
  }
})

// ファイルモードの変更
router.get('/chmod', async ctx => {
  let message = ''
  if (process.platform == 'win32')
    message = 'この機能は Windows では利用できません。'
  await ctx.render('chmod', {'title':'ファイルモードの変更', 'message':message, 'mode':'0755', 'path':''})
})
router.post('/chmod', async ctx => {
  const path = ctx.request.body.path
  if (path == '') {
    await ctx.render('chmod', {'title':'ファイルモードの変更', 'message':'エラー： ファイルのパス名が指定されていません。', 'mode':'0755', 'path':''})
    return
  }
  const mode = ctx.request.body.mode
  if (mode == '') {
    await ctx.render('chmod', {'title':'ファイルモードの変更', 'message':'エラー： ファイルモードが指定されていません。', 'mode':'0755', 'path':path})
    return
  }
  let message = ''
  try {
    const mode8 = parseInt(mode, 8)
    await fs.promises.chmod(path, mode8)
    message = 'ファイルモードが ' + mode + ' に変更されました。'
  }
  catch (err) {
    message = 'エラー： ' + err.message
  }
  await ctx.render('chmod', {'title':'ファイルモードの変更', 'message':message, 'mode':mode, 'path':path})
})

//
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

/*  START */
// アプリケーションにルートを適用する。
app.use(router.routes()).use(router.allowedMethods());

// 'public'ディレクトリ内のファイルを静的ファイルとして公開
app.use(serve(path.join(path.dirname("."), 'public')))

// サーバーの起動
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
