"""Account isolation regression tests; no real Supabase credentials required."""
from fastapi import HTTPException
from app import main


class FakeRows:
    def __init__(self, owner):
        self.owner = owner
    def execute(self, query, args):
        return self
    def fetchone(self):
        return None if self.owner == 'missing' else {'owner_id': self.owner}


def test_private_dance_cannot_be_read_by_another_user():
    try:
        main._assert_readable(FakeRows('account-a'), 10, 'account-b')
        assert False, 'another account must not read a private dance'
    except HTTPException as error:
        assert error.status_code == 404


def test_private_dance_cannot_be_modified_by_another_user():
    try:
        main._assert_owned(FakeRows('account-a'), 10, 'account-b')
        assert False, 'another account must not modify a private dance'
    except HTTPException as error:
        assert error.status_code == 403


def test_owner_can_read_and_modify_own_dance():
    main._assert_readable(FakeRows('account-a'), 10, 'account-a')
    main._assert_owned(FakeRows('account-a'), 10, 'account-a')


def test_public_dances_are_readable_but_not_mutable():
    main._assert_readable(FakeRows(None), 10, 'account-b')
    try:
        main._assert_owned(FakeRows(None), 10, 'account-b')
        assert False, 'public tutorials must not be modified by regular users'
    except HTTPException as error:
        assert error.status_code == 403


def test_missing_dance_returns_not_found():
    try:
        main._assert_readable(FakeRows('missing'), 10, 'account-a')
        assert False
    except HTTPException as error:
        assert error.status_code == 404
