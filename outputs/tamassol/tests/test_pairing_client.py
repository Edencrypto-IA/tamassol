import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from pairing_client import public_bytes, fingerprint, sign_challenge, DOMAIN
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.exceptions import InvalidSignature

class PairingClientTests(unittest.TestCase):
    def test_key_and_fingerprint(self):
        key=ec.generate_private_key(ec.SECP256R1())
        self.assertEqual(len(public_bytes(key)),65)
        self.assertEqual(len(fingerprint(key)),16)
    def test_signature_bound_to_nonce_and_domain(self):
        key=ec.generate_private_key(ec.SECP256R1())
        nonce='ab'*32
        signature=bytes.fromhex(sign_challenge(key,nonce))
        key.public_key().verify(signature,DOMAIN+bytes.fromhex(nonce),ec.ECDSA(hashes.SHA256()))
        for message in [DOMAIN+bytes(32),b'other:'+bytes.fromhex(nonce)]:
            with self.assertRaises(InvalidSignature):
                key.public_key().verify(signature,message,ec.ECDSA(hashes.SHA256()))
        other=ec.generate_private_key(ec.SECP256R1())
        with self.assertRaises(InvalidSignature):
            other.public_key().verify(signature,DOMAIN+bytes.fromhex(nonce),ec.ECDSA(hashes.SHA256()))
    def test_malformed_nonces(self):
        key=ec.generate_private_key(ec.SECP256R1())
        for value in ['', 'f'*63, 'f'*65, 'gg'*32, 'AB'*32]:
            with self.assertRaises(ValueError): sign_challenge(key,value)

if __name__=='__main__': unittest.main()
