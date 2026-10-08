import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from voice_usb import Capture, checksum, is_call

class VoiceTests(unittest.TestCase):
    def test_keywords(self):
        for text in ('Solflame!','Sol flame.','Ola Solflame'):
            self.assertTrue(is_call(text))
        for text in ('sol','estou aqui','envie um sol','nao solflame','Solflame envie um sol',''):
            self.assertFalse(is_call(text))

    def test_transport(self):
        result=Capture(); result.feed('@VOICE BEGIN 128000')
        data=bytes(range(256))*500
        for offset in range(0,len(data),128):
            result.feed(f'@VOICE DATA {offset} {data[offset:offset+128].hex()}')
        result.feed(f'@VOICE END {checksum(data):08x}')
        self.assertTrue(result.done); self.assertEqual(result.data,data)

    def test_missing_packet(self):
        result=Capture(); result.feed('@VOICE BEGIN 128000')
        with self.assertRaises(ValueError): result.feed('@VOICE DATA 128 '+'00'*128)

    def test_retry(self):
        result=Capture(); result.feed('@VOICE BEGIN 128000'); result.feed('@VOICE BEGIN 128000')
        line='@VOICE DATA 0 '+'00'*128
        result.feed(line); result.feed(line)
        self.assertEqual(len(result.data),128)

    def test_corrupt_end(self):
        result=Capture(); result.feed('@VOICE BEGIN 128000')
        with self.assertRaises(ValueError): result.feed('@VOICE END 00000000')

    def test_oversize(self):
        with self.assertRaises(ValueError): Capture().feed('@VOICE BEGIN 999999999')

if __name__=='__main__': unittest.main()
