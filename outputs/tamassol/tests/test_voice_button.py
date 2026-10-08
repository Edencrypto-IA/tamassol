import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import voice_button as b

class ButtonVoiceTests(unittest.TestCase):
    def test_recognition_without_signing(self):
        model=object()
        with patch.object(b,'listen',return_value=True) as listen, patch.object(b,'notify_ui') as notify, patch('voice_transfer.send_once') as send, patch('voice_transfer.preflight') as preflight:
            b.recognize(model)
            listen.assert_called_once_with(model=model,wait_for_enter=False)
            notify.assert_called_once_with('RECOGNIZED')
            send.assert_not_called()
            preflight.assert_not_called()
    def test_not_recognized(self):
        with patch.object(b,'listen',return_value=False), patch.object(b,'notify_ui') as notify:
            b.recognize(object())
            notify.assert_called_once_with('ERROR')
    def test_error_and_interrupt(self):
        with patch.object(b,'listen',side_effect=RuntimeError), patch.object(b,'notify_ui') as notify:
            b.recognize(object())
            notify.assert_called_once_with('ERROR')
        with patch.object(b,'listen',side_effect=KeyboardInterrupt), patch.object(b,'notify_ui') as notify:
            with self.assertRaises(KeyboardInterrupt): b.recognize(object())
            notify.assert_called_once_with('CANCELLED')
