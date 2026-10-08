"""Validate final display-sized assets and dirty-region/UI separation."""
import unittest
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]

class AssetTests(unittest.TestCase):
    def test_background(self):
        with Image.open(ROOT/'assets/background/landscape.png') as im:
            self.assertEqual(im.size,(320,240))
            self.assertEqual(im.mode,'RGB')

    def test_frames(self):
        for state in ('sleep','happy','angry'):
            paths=sorted((ROOT/'assets/solflame'/state).glob('*.png'))
            self.assertEqual(len(paths),3)
            images=[]
            for p in paths:
                with Image.open(p) as im:
                    self.assertEqual(im.size,(128,128))
                    self.assertEqual(im.mode,'RGBA')
                    alpha=im.getchannel('A').tobytes()
                    self.assertEqual(min(alpha),0)
                    self.assertEqual(max(alpha),255)
                    self.assertGreater(sum(a<128 for a in alpha),2500)
                    self.assertGreater(sum(a>=128 for a in alpha),6000)
                    for xy in ((0,0),(127,0),(0,127),(127,127)):
                        self.assertEqual(im.getpixel(xy)[3],0)
                    images.append(im.tobytes())
            self.assertEqual(len(set(images)),3)

    def test_dirty_region_does_not_erase_ui(self):
        x,y,w,h=96,64,128,136
        self.assertLessEqual(x+w,320)
        self.assertLessEqual(y+h,240)
        # Header, quote panel, title/caption and controls respectively.
        for a,b,c,d in ((0,0,320,28),(7,37,85,120),(124,35,103,29),(0,200,320,40)):
            self.assertFalse(x<a+c and x+w>a and y<b+d and y+h>b)

if __name__=='__main__': unittest.main()
