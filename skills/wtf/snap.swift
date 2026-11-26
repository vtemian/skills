// Render a page in WebKit, check its diagrams and save a picture of the whole page.
// Built and run by page.sh:
//
//   snap <page.html> <out.png>
//
// WebKit is the engine that draws HTML-over-SVG differently from Chrome, so this is
// the check that catches a diagram that looks right in one browser and not in the other.
// Prints one line per finding, "layout ok" when there is none, and exits 1 on a finding.

import Cocoa
import WebKit

let width = 1360
let check = """
(() => {
  const found = []
  const area = box => Math.max(0, box.width) * Math.max(0, box.height)
  const shared = (one, two) =>
    Math.max(0, Math.min(one.right, two.right) - Math.max(one.left, two.left)) *
    Math.max(0, Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top))
  document.querySelectorAll('figure.diagram').forEach((figure, index) => {
    const name = `diagram ${String(index + 1).padStart(2, '0')}`
    const svg = figure.querySelector('svg')
    const cards = [...figure.querySelectorAll('.card')]
    const boxes = cards.map(card => card.getBoundingClientRect())
    if (!svg || svg.getBoundingClientRect().width < 50) found.push(`${name}: the drawing has no size`)
    if (cards.length && !figure.querySelector('.stage.placed')) found.push(`${name}: the cards were never placed`)
    boxes.forEach((box, at) => {
      if (area(box) < 100) found.push(`${name}: card "${cards[at].dataset.box}" has no size`)
      boxes.slice(at + 1).forEach((other, next) => {
        if (shared(box, other) > 0.2 * Math.min(area(box), area(other)))
          found.push(`${name}: cards "${cards[at].dataset.box}" and "${cards[at + 1 + next].dataset.box}" overlap`)
      })
    })
    const text = [...figure.querySelectorAll('.card .title, .card .detail')].filter(part => part.scrollWidth > part.clientWidth + 1)
    text.forEach(part => found.push(`${name}: "${part.textContent}" is cut off in its card; shorten it`))
  })
  return JSON.stringify({ height: Math.ceil(document.documentElement.scrollHeight), found })
})()
"""

struct Report: Decodable {
    let height: Int
    let found: [String]
}

final class Snapper: NSObject, WKNavigationDelegate {
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 1000))
    let window: NSWindow
    let out: String

    init(out: String) {
        self.out = out
        window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        window.contentView = view
        view.navigationDelegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.inspect() }
    }

    func inspect() {
        view.evaluateJavaScript(check) { value, _ in
            guard let text = value as? String, let report = try? JSONDecoder().decode(Report.self, from: Data(text.utf8)) else {
                print("layout check did not run")
                exit(1)
            }
            let size = NSSize(width: width, height: min(report.height, 12000))
            self.window.setContentSize(size)
            self.view.setFrameSize(size)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.save(report, size) }
        }
    }

    func save(_ report: Report, _ size: NSSize) {
        let whole = WKSnapshotConfiguration()
        whole.rect = NSRect(origin: .zero, size: size)
        whole.snapshotWidth = NSNumber(value: width)
        view.takeSnapshot(with: whole) { image, _ in
            if let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
               let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: self.out))
            }
            report.found.forEach { print($0) }
            if report.found.isEmpty { print("layout ok") }
            exit(report.found.isEmpty ? 0 : 1)
        }
    }
}

let page = URL(fileURLWithPath: CommandLine.arguments[1])
let snapper = Snapper(out: CommandLine.arguments[2])
snapper.view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
NSApplication.shared.run()
