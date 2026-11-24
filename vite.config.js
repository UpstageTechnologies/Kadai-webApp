import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import https from 'node:https'

function webImageSearchPlugin() {
  const handleRequest = (req, res) => {
    try {
      const urlObj = new URL(req.url, 'http://localhost')
      const q = (urlObj.searchParams.get('q') || '').trim()

      if (!q) {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(JSON.stringify({ images: [] }))
        return
      }

      // Search Bing Images for clean commercial product catalog pack photos
      const searchQuery = `${q} product packaging photo`
      const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(searchQuery)}&qft=+filterui:photo-photo&form=HDRSC2&first=1`

      https.get(bingUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      }, (bingRes) => {
        let data = ''
        bingRes.on('data', chunk => data += chunk)
        bingRes.on('end', () => {
          const images = []
          const re = /murl&quot;:&quot;(https?:[^&]+)&quot;/g
          let match
          while ((match = re.exec(data)) !== null) {
            const img = match[1]
            if (img && !img.includes('bing.com') && !img.endsWith('.svg')) {
              images.push(img)
            }
          }
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(JSON.stringify({ images: images.slice(0, 35) }))
        })
      }).on('error', (err) => {
        console.error('Web Image Search proxy error:', err)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(JSON.stringify({ images: [] }))
      })
    } catch (e) {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(JSON.stringify({ images: [], error: e.message }))
    }
  }

  return {
    name: 'web-image-search-api',
    configureServer(server) {
      server.middlewares.use('/api/search-web-images', handleRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/search-web-images', handleRequest)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), webImageSearchPlugin()],
})
